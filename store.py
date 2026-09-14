"""Collection and deck operations, scoped to one user.

This replaces the loose-JSON store for anything served over the network. The
rules it enforces are the same ones the file version enforced:

  * a printing is one row, and adding it again raises the count;
  * the copies of a card spread across a user's decks can never exceed the
    number that user owns.

Every function takes `user_id` first. There is no way to read or write another
user's rows without passing their id, which is the point.
"""

from __future__ import annotations

import datetime
import json
import uuid

import db

MAX_NAME = 60
DEFAULT_DECK_NAME = "New deck"
PROFILE_FORMAT = "mtg-card-viewer-profile"
PROFILE_VERSION = 2


class StoreError(Exception):
    """An operation the rules do not allow."""


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _clean_name(name):
    return " ".join(str(name or "").split())[:MAX_NAME] or DEFAULT_DECK_NAME


# ------------------------------------------------------------ card cache

def remember_card(card, conn=None):
    """Upsert a Scryfall payload into the shared cache."""
    conn = conn or db.connect()
    card_id = card.get("id")
    if not card_id:
        raise StoreError("Card has no id")
    conn.execute(
        """INSERT INTO cards (id, name, set_code, collector_number, rarity, data, fetched)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, set_code = excluded.set_code,
             collector_number = excluded.collector_number, rarity = excluded.rarity,
             data = excluded.data, fetched = excluded.fetched""",
        (card_id, card.get("name") or "", card.get("set"), card.get("collector_number"),
         card.get("rarity"), json.dumps(card, ensure_ascii=False), _now()),
    )
    return card_id


def card_json(row):
    try:
        return json.loads(row["data"])
    except (ValueError, TypeError):
        return {}


# ------------------------------------------------------------ collection

def add_card(user_id, card, quantity=1):
    """Add copies of a printing, merging with any already held."""
    quantity = max(1, int(quantity))
    with db.transaction() as conn:
        card_id = remember_card(card, conn)
        conn.execute(
            """INSERT INTO collection (user_id, card_id, quantity, added)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id, card_id)
               DO UPDATE SET quantity = quantity + excluded.quantity""",
            (user_id, card_id, quantity, _now()),
        )
    return entry(user_id, card_id)


def add_many(user_id, pairs):
    """Bulk add — one transaction for a whole import. pairs: [(card, qty)]."""
    total = 0
    with db.transaction() as conn:
        for card, quantity in pairs:
            quantity = max(1, int(quantity))
            card_id = remember_card(card, conn)
            conn.execute(
                """INSERT INTO collection (user_id, card_id, quantity, added)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT (user_id, card_id)
                   DO UPDATE SET quantity = quantity + excluded.quantity""",
                (user_id, card_id, quantity, _now()),
            )
            total += quantity
    return total


def remove_card(user_id, card_id, drop_all=False):
    """Remove one copy, or all of them.  Refuses to strip a copy a deck holds."""
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT quantity FROM collection WHERE user_id = ? AND card_id = ?",
            (user_id, card_id),
        ).fetchone()
        if not row:
            return None

        owned = int(row["quantity"])
        held = _allocations(conn, user_id).get(card_id, [])
        allocated = sum(item["quantity"] for item in held)
        wanted = owned if drop_all else 1
        if owned - allocated < wanted:
            where = ", ".join("%s (%d)" % (h["deck_name"], h["quantity"]) for h in held)
            raise StoreError(
                "%d of your %d copies %s in a deck - %s. Take %s out of the deck first."
                % (allocated, owned, "is" if allocated == 1 else "are", where,
                   "it" if allocated == 1 else "them")
            )

        remaining = 0 if drop_all else owned - 1
        if remaining <= 0:
            conn.execute("DELETE FROM collection WHERE user_id = ? AND card_id = ?",
                         (user_id, card_id))
            return None
        conn.execute(
            "UPDATE collection SET quantity = ? WHERE user_id = ? AND card_id = ?",
            (remaining, user_id, card_id))
    return entry(user_id, card_id)


def entry(user_id, card_id, conn=None):
    conn = conn or db.connect()
    row = conn.execute(
        """SELECT c.card_id, c.quantity, c.added, k.data
             FROM collection c JOIN cards k ON k.id = c.card_id
            WHERE c.user_id = ? AND c.card_id = ?""",
        (user_id, card_id),
    ).fetchone()
    return _entry_from_row(row) if row else None


def _entry_from_row(row):
    card = card_json(row)
    return {
        "id": row["card_id"],
        "name": card.get("name"),
        "set": card.get("set"),
        "set_name": card.get("set_name"),
        "collector_number": card.get("collector_number"),
        "rarity": card.get("rarity"),
        "quantity": int(row["quantity"]),
        "added": row["added"],
        "card": card,
    }


def entries(user_id, conn=None):
    conn = conn or db.connect()
    rows = conn.execute(
        """SELECT c.card_id, c.quantity, c.added, k.data
             FROM collection c JOIN cards k ON k.id = c.card_id
            WHERE c.user_id = ?
            ORDER BY c.added DESC, k.name COLLATE NOCASE""",
        (user_id,),
    ).fetchall()
    return [_entry_from_row(row) for row in rows]


# ----------------------------------------------------------------- decks

def create_deck(user_id, name=DEFAULT_DECK_NAME):
    deck_id = uuid.uuid4().hex
    now = _now()
    with db.transaction() as conn:
        conn.execute(
            """INSERT INTO decks (id, user_id, name, commander_id, created, updated)
               VALUES (?, ?, ?, NULL, ?, ?)""",
            (deck_id, user_id, _clean_name(name), now, now))
    return deck_id


DECK_IMPORT_MODES = {"collection", "add_missing", "prefer_collection", "proxies"}


def import_deck(user_id, name, resolved, mode):
    """Create a deck from already-resolved import lines in one transaction.

    Normal cards reserve owned copies; proxy lines deliberately do not. A line
    is kept whole because a deck card has one proxy flag, rather than mixing
    owned and proxy copies of the same printing in the same line.
    """
    if mode not in DECK_IMPORT_MODES:
        raise StoreError("Choose how the imported deck should use your collection.")
    if not resolved:
        raise StoreError("There are no resolved cards to put in a deck.")

    deck_id = uuid.uuid4().hex
    deck_name = _clean_name(name or DEFAULT_DECK_NAME)
    report = {"deck_id": deck_id, "name": deck_name, "mode": mode,
              "owned": 0, "proxies": 0, "added_to_collection": 0,
              "skipped": 0}
    with db.transaction() as conn:
        now = _now()
        conn.execute(
            """INSERT INTO decks (id, user_id, name, commander_id, created, updated)
               VALUES (?, ?, ?, NULL, ?, ?)""",
            (deck_id, user_id, deck_name, now, now))
        allocations = _allocations(conn, user_id)

        for item in resolved:
            card = item.get("card") or {}
            quantity = max(1, int((item.get("entry") or {}).get("quantity", 1)))
            card_id = remember_card(card, conn)
            owned_row = conn.execute(
                "SELECT quantity FROM collection WHERE user_id = ? AND card_id = ?",
                (user_id, card_id)).fetchone()
            owned = int(owned_row["quantity"]) if owned_row else 0
            allocated = sum(line["quantity"] for line in allocations.get(card_id, []))
            free = max(0, owned - allocated)

            proxy = mode == "proxies" or (mode == "prefer_collection" and free < quantity)
            if mode == "collection" and free < quantity:
                report["skipped"] += quantity
                continue
            if mode == "add_missing":
                missing = max(0, quantity - free)
                if missing:
                    conn.execute(
                        """INSERT INTO collection (user_id, card_id, quantity, added)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT (user_id, card_id)
                           DO UPDATE SET quantity = quantity + excluded.quantity""",
                        (user_id, card_id, missing, now))
                    report["added_to_collection"] += missing
                    owned += missing
                    free += missing

            conn.execute(
                """INSERT INTO deck_cards (deck_id, card_id, quantity, zone, proxy)
                   VALUES (?, ?, ?, 'main', ?)""",
                (deck_id, card_id, quantity, 1 if proxy else 0))
            if proxy:
                report["proxies"] += quantity
            else:
                report["owned"] += quantity
                allocations.setdefault(card_id, []).append({
                    "deck_id": deck_id, "deck_name": deck_name, "quantity": quantity,
                })
    return report


def _owned_deck(conn, user_id, deck_id):
    row = conn.execute("SELECT * FROM decks WHERE id = ? AND user_id = ?",
                       (deck_id, user_id)).fetchone()
    if not row:
        raise StoreError("That deck no longer exists.")
    return row


def deck_card_ids(user_id, deck_id, conn=None):
    """The collection records whose allocation labels refer to this deck."""
    conn = conn or db.connect()
    _owned_deck(conn, user_id, deck_id)
    return [row["card_id"] for row in conn.execute(
        """SELECT dc.card_id FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
             WHERE dc.deck_id = ? AND d.user_id = ? AND dc.zone = 'main' AND dc.proxy = 0""",
        (deck_id, user_id),
    )]


def rename_deck(user_id, deck_id, name):
    with db.transaction() as conn:
        _owned_deck(conn, user_id, deck_id)
        conn.execute("UPDATE decks SET name = ?, updated = ? WHERE id = ?",
                     (_clean_name(name), _now(), deck_id))
    return deck_id


def delete_deck(user_id, deck_id):
    """Deleting a deck releases every copy it held back to the collection."""
    with db.transaction() as conn:
        _owned_deck(conn, user_id, deck_id)
        released = [row["card_id"] for row in conn.execute(
            "SELECT card_id FROM deck_cards WHERE deck_id = ? AND zone = 'main' AND proxy = 0", (deck_id,)
        )]
        conn.execute("DELETE FROM decks WHERE id = ?", (deck_id,))   # cascades
    return released


def set_commander(user_id, deck_id, card_id):
    with db.transaction() as conn:
        _owned_deck(conn, user_id, deck_id)
        if card_id:
            held = conn.execute(
                "SELECT 1 FROM deck_cards WHERE deck_id = ? AND card_id = ? AND zone = 'main'",
                (deck_id, card_id)).fetchone()
            if not held:
                raise StoreError("Add the card to the deck before making it the commander.")
        conn.execute("UPDATE decks SET commander_id = ?, updated = ? WHERE id = ?",
                     (card_id or None, _now(), deck_id))
    return deck_id


def _allocations(conn, user_id):
    """card id -> [{deck_id, deck_name, quantity}] across this user's decks."""
    rows = conn.execute(
        """SELECT dc.card_id, dc.quantity, d.id AS deck_id, d.name AS deck_name
             FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
             WHERE d.user_id = ? AND dc.zone = 'main' AND dc.proxy = 0
            ORDER BY d.name COLLATE NOCASE""",
        (user_id,),
    ).fetchall()
    spread = {}
    for row in rows:
        spread.setdefault(row["card_id"], []).append({
            "deck_id": row["deck_id"], "deck_name": row["deck_name"],
            "quantity": int(row["quantity"]),
        })
    return spread


def _zone(value):
    if value not in ("main", "maybeboard"):
        raise StoreError("Choose the main deck or maybeboard.")
    return value


def deck_add(user_id, deck_id, card_id=None, quantity=1, card=None, zone="main"):
    """Add an owned card, or cache an unowned card as a clearly marked proxy."""
    quantity = max(1, int(quantity))
    zone = _zone(zone)
    with db.transaction() as conn:
        _owned_deck(conn, user_id, deck_id)
        if card:
            card_id = remember_card(card, conn)
        if not card_id:
            raise StoreError("Choose a card first.")
        owned = conn.execute(
            "SELECT quantity FROM collection WHERE user_id = ? AND card_id = ?",
            (user_id, card_id)).fetchone()
        existing = conn.execute(
            "SELECT proxy, zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, card_id),
        ).fetchone()
        if existing and existing["zone"] != zone:
            raise StoreError(
                "This printing is already in the %s. Open it to move it instead."
                % ("main deck" if existing["zone"] == "main" else "maybeboard")
            )
        # Adding another copy to an existing proxy line keeps that line a proxy.
        # The user can deliberately switch it to an owned copy from its detail view.
        proxy = not owned or bool(existing and existing["proxy"])
        if proxy and not card and not (existing and existing["proxy"]):
            raise StoreError("That card is not in your collection.")

        if owned and zone == "main" and not proxy:
            held = _allocations(conn, user_id).get(card_id, [])
            allocated = sum(item["quantity"] for item in held)
            free = int(owned["quantity"]) - allocated
            if free < quantity:
                name = conn.execute("SELECT name FROM cards WHERE id = ?",
                                    (card_id,)).fetchone()
                where = ", ".join("%s (%d)" % (h["deck_name"], h["quantity"]) for h in held)
                raise StoreError(
                    "You own %d %s and every spare copy is already in a deck%s."
                    % (int(owned["quantity"]), name["name"] if name else "of that card",
                       " - " + where if where else ""))

        conn.execute(
            """INSERT INTO deck_cards (deck_id, card_id, quantity, zone, proxy) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (deck_id, card_id)
               DO UPDATE SET quantity = quantity + excluded.quantity""",
            (deck_id, card_id, quantity, zone, 1 if proxy else 0))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return {"deck_id": deck_id, "card_id": card_id, "proxy_added": proxy}


def deck_remove(user_id, deck_id, card_id, drop_all=False):
    with db.transaction() as conn:
        deck = _owned_deck(conn, user_id, deck_id)
        row = conn.execute(
            "SELECT quantity, zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, card_id)).fetchone()
        if not row:
            return deck_id
        remaining = 0 if drop_all else int(row["quantity"]) - 1
        if remaining > 0:
            conn.execute(
                "UPDATE deck_cards SET quantity = ? WHERE deck_id = ? AND card_id = ?",
                (remaining, deck_id, card_id))
        else:
            conn.execute("DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?",
                         (deck_id, card_id))
            if deck["commander_id"] == card_id:
                conn.execute("UPDATE decks SET commander_id = NULL WHERE id = ?", (deck_id,))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return deck_id


def set_proxy(user_id, deck_id, card_id, proxy):
    """Mark a deck card as a proxy, or require an owned copy before clearing it."""
    with db.transaction() as conn:
        _owned_deck(conn, user_id, deck_id)
        line = conn.execute(
            "SELECT quantity, zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, card_id),
        ).fetchone()
        if not line:
            raise StoreError("That card is no longer in the deck.")
        proxy = bool(proxy)
        if not proxy:
            owned = conn.execute(
                "SELECT quantity FROM collection WHERE user_id = ? AND card_id = ?",
                (user_id, card_id),
            ).fetchone()
            if not owned:
                raise StoreError("Add this card to your collection before clearing its proxy flag.")
            if line["zone"] == "main":
                allocated = sum(item["quantity"] for item in _allocations(conn, user_id).get(card_id, []))
                if int(owned["quantity"]) - allocated < int(line["quantity"]):
                    raise StoreError("You do not have enough free copies to use this as a non-proxy.")
        conn.execute("UPDATE deck_cards SET proxy = ? WHERE deck_id = ? AND card_id = ?",
                     (1 if proxy else 0, deck_id, card_id))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return deck_id


def move_deck_card(user_id, deck_id, card_id, zone):
    """Move one card line between the main deck and the maybeboard."""
    zone = _zone(zone)
    with db.transaction() as conn:
        deck = _owned_deck(conn, user_id, deck_id)
        line = conn.execute(
            "SELECT quantity, proxy, zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, card_id),
        ).fetchone()
        if not line:
            raise StoreError("That card is no longer in the deck.")
        if line["zone"] == zone:
            return deck_id
        if zone == "main" and not line["proxy"]:
            owned = conn.execute(
                "SELECT quantity FROM collection WHERE user_id = ? AND card_id = ?",
                (user_id, card_id),
            ).fetchone()
            allocated = sum(item["quantity"] for item in _allocations(conn, user_id).get(card_id, []))
            if not owned or int(owned["quantity"]) - allocated < int(line["quantity"]):
                raise StoreError("You do not have enough free copies to move this into the main deck.")
        conn.execute("UPDATE deck_cards SET zone = ? WHERE deck_id = ? AND card_id = ?",
                     (zone, deck_id, card_id))
        if zone == "maybeboard" and deck["commander_id"] == card_id:
            conn.execute("UPDATE decks SET commander_id = NULL WHERE id = ?", (deck_id,))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return deck_id


# --------------------------------------------------------------- library

def summary(user_id, conn=None):
    """Small aggregate for the library header, without loading every card."""
    conn = conn or db.connect()
    owned = conn.execute(
        "SELECT COUNT(*) AS distinct_count, COALESCE(SUM(quantity), 0) AS total "
        "FROM collection WHERE user_id = ?", (user_id,)
    ).fetchone()
    allocated = conn.execute(
        """SELECT COALESCE(SUM(dc.quantity), 0) AS total
             FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
            WHERE d.user_id = ? AND dc.zone = 'main' AND dc.proxy = 0""", (user_id,)
    ).fetchone()["total"]
    value = conn.execute(
        """SELECT COALESCE(SUM(c.quantity *
                   CAST(json_extract(k.data, '$.prices.usd') AS REAL)), 0) AS total
             FROM collection c JOIN cards k ON k.id = c.card_id
            WHERE c.user_id = ?""", (user_id,)
    ).fetchone()["total"]
    total = int(owned["total"])
    allocated = int(allocated)
    return {
        "distinct": int(owned["distinct_count"]),
        "total": total,
        "value": round(float(value), 2),
        "free": total - allocated,
        "allocated": allocated,
        "decks": int(conn.execute(
            "SELECT COUNT(*) FROM decks WHERE user_id = ?", (user_id,)
        ).fetchone()[0]),
    }


def entry_state(user_id, card_id, conn=None):
    """One collection entry, enriched with its current deck allocations."""
    conn = conn or db.connect()
    item = entry(user_id, card_id, conn)
    if item is None:
        return None
    locations = _allocations(conn, user_id).get(card_id, [])
    allocated = sum(location["quantity"] for location in locations)
    item.update({
        "allocated": allocated,
        "available": max(0, item["quantity"] - allocated),
        "locations": locations,
    })
    return item


def deck_state(user_id, deck_id, conn=None):
    """One deck with its current cards; return None when it no longer exists."""
    conn = conn or db.connect()
    row = conn.execute("SELECT * FROM decks WHERE id = ? AND user_id = ?",
                       (deck_id, user_id)).fetchone()
    if row is None:
        return None
    cards = conn.execute(
        """SELECT dc.card_id, dc.quantity, dc.zone, dc.proxy, k.data,
                  c.card_id IS NULL AS missing
             FROM deck_cards dc
             JOIN cards k ON k.id = dc.card_id
             LEFT JOIN collection c ON c.user_id = ? AND c.card_id = dc.card_id
            WHERE dc.deck_id = ? ORDER BY dc.card_id""",
        (user_id, deck_id),
    ).fetchall()
    lines = [{"card_id": card["card_id"], "quantity": int(card["quantity"]),
              "zone": card["zone"], "proxy": bool(card["proxy"]),
              "missing": bool(card["missing"]), "card": card_json(card)} for card in cards]
    return {
        "id": row["id"], "name": row["name"], "created": row["created"],
        "updated": row["updated"], "commander_id": row["commander_id"],
        "cards": lines,
        "count": sum(line["quantity"] for line in lines if line["zone"] == "main"),
        "maybeboard_count": sum(line["quantity"] for line in lines if line["zone"] == "maybeboard"),
    }


def patch(user_id, entry_ids=(), deck_ids=()):
    """The small, self-consistent state change returned after a mutation."""
    conn = db.connect()
    entries = [item for card_id in dict.fromkeys(entry_ids)
               if (item := entry_state(user_id, card_id, conn)) is not None]
    decks = [deck for deck_id in dict.fromkeys(deck_ids)
             if (deck := deck_state(user_id, deck_id, conn)) is not None]
    return {"entries": entries, "decks": decks, "summary": summary(user_id, conn)}

def library(user_id):
    """One consistent snapshot: collection, decks, and who holds what."""
    conn = db.connect()
    owned = entries(user_id, conn)
    spread = _allocations(conn, user_id)
    for item in owned:
        held = spread.get(item["id"], [])
        allocated = sum(h["quantity"] for h in held)
        item["allocated"] = allocated
        item["available"] = max(0, item["quantity"] - allocated)
        item["locations"] = held

    deck_rows = conn.execute(
        "SELECT * FROM decks WHERE user_id = ? ORDER BY name COLLATE NOCASE",
        (user_id,)).fetchall()
    decks = []
    for row in deck_rows:
        decks.append(deck_state(user_id, row["id"], conn))

    return {"entries": owned, "decks": decks, "summary": summary(user_id, conn)}


# ---------------------------------------------------------- profile backup

def export_profile(user_id):
    """A portable backup of one user's cards and decks, never their account."""
    snapshot = library(user_id)
    return {
        "format": PROFILE_FORMAT,
        "version": PROFILE_VERSION,
        "exported": _now(),
        "collection": [
            {"card": entry["card"], "quantity": entry["quantity"]}
            for entry in snapshot["entries"]
        ],
        "decks": [
            {
                "name": deck["name"],
                "commander_id": deck["commander_id"],
                "cards": deck["cards"],
            }
            for deck in snapshot["decks"]
        ],
    }


def _profile_quantity(value):
    try:
        quantity = int(value)
    except (TypeError, ValueError):
        return 0
    return quantity if quantity > 0 else 0


def import_profile(user_id, profile, mode="merge"):
    """Import a profile backup, either merging it or replacing one library.

    Cards are added to the collection and each imported deck gets a fresh id.
    In ``replace`` mode, only the importing user's decks and collection rows
    are deleted first; shared cached card data and every other user's library
    are untouched. Broken records are skipped and counted rather than leaving
    a half-valid deck behind.
    """
    if not isinstance(profile, dict):
        raise StoreError("That file is not a profile backup.")
    if profile.get("format") != PROFILE_FORMAT or profile.get("version") not in (1, PROFILE_VERSION):
        raise StoreError("That profile is from an unsupported version of MTG Card Viewer.")
    if mode not in ("merge", "replace"):
        raise StoreError("Choose whether to add to or replace your collection.")
    collection = profile.get("collection")
    decks = profile.get("decks")
    if not isinstance(collection, list) or not isinstance(decks, list):
        raise StoreError("That profile backup is incomplete.")

    report = {
        "cards": 0, "printings": 0, "decks": 0,
        "skipped_cards": 0, "skipped_deck_cards": 0,
    }
    with db.transaction() as conn:
        if mode == "replace":
            conn.execute("DELETE FROM decks WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM collection WHERE user_id = ?", (user_id,))
        for item in collection:
            card = item.get("card") if isinstance(item, dict) else None
            quantity = _profile_quantity(item.get("quantity")) if isinstance(item, dict) else 0
            if not isinstance(card, dict) or not card.get("id") or not quantity:
                report["skipped_cards"] += 1
                continue
            card_id = remember_card(card, conn)
            conn.execute(
                """INSERT INTO collection (user_id, card_id, quantity, added)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT (user_id, card_id)
                   DO UPDATE SET quantity = quantity + excluded.quantity""",
                (user_id, card_id, quantity, _now()),
            )
            report["cards"] += quantity
            report["printings"] += 1

        allocations = _allocations(conn, user_id)
        for source_deck in decks:
            if not isinstance(source_deck, dict) or not isinstance(source_deck.get("cards"), list):
                report["skipped_deck_cards"] += 1
                continue
            deck_id = uuid.uuid4().hex
            now = _now()
            conn.execute(
                """INSERT INTO decks (id, user_id, name, commander_id, created, updated)
                   VALUES (?, ?, ?, NULL, ?, ?)""",
                (deck_id, user_id, _clean_name(source_deck.get("name")), now, now),
            )
            held_ids = set()
            for line in source_deck["cards"]:
                card_id = line.get("card_id") if isinstance(line, dict) else None
                quantity = _profile_quantity(line.get("quantity")) if isinstance(line, dict) else 0
                if not card_id or not quantity:
                    report["skipped_deck_cards"] += 1
                    continue
                zone = line.get("zone", "main") if isinstance(line, dict) else "main"
                proxy = bool(line.get("proxy")) if isinstance(line, dict) else False
                if zone not in ("main", "maybeboard"):
                    report["skipped_deck_cards"] += 1
                    continue
                card = line.get("card") if isinstance(line, dict) else None
                if proxy and isinstance(card, dict) and card.get("id") == card_id:
                    remember_card(card, conn)
                cached = conn.execute("SELECT 1 FROM cards WHERE id = ?", (card_id,)).fetchone()
                if proxy and not cached:
                    # A proxy must carry its card data unless this database has
                    # already cached the printing. Do not create a broken row.
                    report["skipped_deck_cards"] += 1
                    continue
                owned = conn.execute(
                    "SELECT quantity FROM collection WHERE user_id = ? AND card_id = ?",
                    (user_id, card_id),
                ).fetchone()
                allocated = sum(item["quantity"] for item in allocations.get(card_id, []))
                if not proxy and (owned is None or (zone == "main" and
                                  int(owned["quantity"]) - allocated < quantity)):
                    report["skipped_deck_cards"] += 1
                    continue
                conn.execute(
                    """INSERT INTO deck_cards (deck_id, card_id, quantity, zone, proxy) VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (deck_id, card_id)
                       DO UPDATE SET quantity = quantity + excluded.quantity""",
                    (deck_id, card_id, quantity, zone, 1 if proxy else 0),
                )
                if zone == "main" and not proxy:
                    allocations.setdefault(card_id, []).append({
                        "deck_id": deck_id, "deck_name": source_deck.get("name") or DEFAULT_DECK_NAME,
                        "quantity": quantity,
                    })
                if zone == "main":
                    held_ids.add(card_id)

            commander_id = source_deck.get("commander_id")
            if commander_id in held_ids:
                conn.execute("UPDATE decks SET commander_id = ? WHERE id = ?",
                             (commander_id, deck_id))
            report["decks"] += 1
    return report

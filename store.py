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
from decimal import Decimal

import datetime
import json
import uuid

import db

MAX_NAME = 60
DEFAULT_DECK_NAME = "New deck"
PROFILE_FORMAT = "mtg-card-viewer-profile"
PROFILE_VERSION = 4


class StoreError(Exception):
    """An operation the rules do not allow."""


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _clean_name(name):
    return " ".join(str(name or "").split())[:MAX_NAME] or DEFAULT_DECK_NAME


def _clean_category(category):
    return " ".join(str(category or "").split())[:MAX_NAME]


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


def _cheapest_price_key(card):
    identity = "oracle:" + card["oracle_id"] if card.get("oracle_id") else "name:" + card["name"]
    return "cheapest_price:" + identity


def remember_cheapest_price(card, price):
    """Keep explicit refresh results across restarts, including unpriced cards."""
    with db.transaction() as conn:
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                     (_cheapest_price_key(card), str(price) if price is not None else ""))


def cached_cheapest_price(card):
    """Read the last saved estimate; never fetch or expire it on navigation."""
    row = db.connect().execute("SELECT value FROM meta WHERE key = ?",
                               (_cheapest_price_key(card),)).fetchone()
    return Decimal(row["value"]) if row and row["value"] else None


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


# ------------------------------------------------------------- wishlist

def wishlist_add(user_id, card, quantity=1):
    """Add a manual wish while keeping deck-proxy needs independent."""
    quantity = max(1, int(quantity))
    with db.transaction() as conn:
        card_id = remember_card(card, conn)
        conn.execute(
            """INSERT INTO wishlist (user_id, card_id, quantity, added)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (user_id, card_id)
               DO UPDATE SET quantity = quantity + excluded.quantity""",
            (user_id, card_id, quantity, _now()),
        )
    return card_id


def wishlist_remove(user_id, card_id, drop_all=False):
    """Remove only the manual wish; proxy-derived needs remain visible."""
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT quantity FROM wishlist WHERE user_id = ? AND card_id = ?",
            (user_id, card_id),
        ).fetchone()
        if not row:
            return card_id
        remaining = 0 if drop_all else int(row["quantity"]) - 1
        if remaining > 0:
            conn.execute(
                "UPDATE wishlist SET quantity = ? WHERE user_id = ? AND card_id = ?",
                (remaining, user_id, card_id),
            )
        else:
            conn.execute("DELETE FROM wishlist WHERE user_id = ? AND card_id = ?",
                         (user_id, card_id))
    return card_id


def wishlist(user_id, conn=None):
    """Merge manual wishes and proxy requirements without double-counting overlap."""
    conn = conn or db.connect()
    rows = conn.execute(
        """SELECT k.id AS card_id, k.data, w.quantity AS manual_quantity, w.added,
                  COALESCE(SUM(CASE WHEN d.id IS NOT NULL AND dc.proxy = 1 AND dc.zone = 'main'
                                    THEN dc.quantity ELSE 0 END), 0) AS proxy_quantity
             FROM cards k
             LEFT JOIN wishlist w ON w.card_id = k.id AND w.user_id = ?
             LEFT JOIN deck_cards dc ON dc.card_id = k.id AND dc.proxy = 1 AND dc.zone = 'main'
             LEFT JOIN decks d ON d.id = dc.deck_id AND d.user_id = ?
            WHERE w.card_id IS NOT NULL OR d.id IS NOT NULL
            GROUP BY k.id, k.data, w.quantity, w.added
            ORDER BY k.name COLLATE NOCASE""",
        (user_id, user_id),
    ).fetchall()
    result = []
    for row in rows:
        manual = int(row["manual_quantity"] or 0)
        proxy = int(row["proxy_quantity"] or 0)
        if not manual and not proxy:
            continue
        card = card_json(row)
        deck_rows = conn.execute(
            """SELECT d.id, d.name, dc.quantity FROM deck_cards dc
                 JOIN decks d ON d.id = dc.deck_id
                WHERE d.user_id = ? AND dc.card_id = ? AND dc.proxy = 1
                  AND dc.zone = 'main' ORDER BY d.name COLLATE NOCASE""",
            (user_id, row["card_id"]),
        ).fetchall()
        result.append({
            "id": row["card_id"], "name": card.get("name"), "card": card,
            "set": card.get("set"), "collector_number": card.get("collector_number"),
            "manual_quantity": manual, "proxy_quantity": proxy,
            "quantity": max(manual, proxy), "added": row["added"],
            "proxy_decks": [{"deck_id": item["id"], "deck_name": item["name"],
                             "quantity": int(item["quantity"])} for item in deck_rows],
        })
    return result


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


def set_deck_category(user_id, deck_id, category):
    with db.transaction() as conn:
        _owned_deck(conn, user_id, deck_id)
        conn.execute("UPDATE decks SET category = ?, updated = ? WHERE id = ?",
                     (_clean_category(category), _now(), deck_id))
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


DECK_ROLE_COLUMNS = {
    "commander": ("commander_id", "main"),
    "partner": ("partner_id", "main"),
    "companion": ("companion_id", "maybeboard"),
}


def set_deck_role(user_id, deck_id, card_id, role="commander"):
    if role not in DECK_ROLE_COLUMNS:
        raise StoreError("Choose commander, partner, or companion.")
    column, expected_zone = DECK_ROLE_COLUMNS[role]
    with db.transaction() as conn:
        deck = _owned_deck(conn, user_id, deck_id)
        if card_id:
            held = conn.execute(
                "SELECT zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
                (deck_id, card_id),
            ).fetchone()
            if not held:
                raise StoreError("Add the card to the deck before assigning that role.")
            if held["zone"] != expected_zone:
                destination = "main deck" if expected_zone == "main" else "maybeboard"
                raise StoreError(f"Move the card to the {destination} before assigning that role.")
        # A printing can occupy only one special slot at a time. The role
        # choice itself is intentionally permissive: partner compatibility
        # and companion deck-building conditions are left to the player.
        values = {key: deck[key] for key, _zone in DECK_ROLE_COLUMNS.values()}
        if card_id:
            values = {key: None if value == card_id else value
                      for key, value in values.items()}
        values[column] = card_id or None
        conn.execute(
            "UPDATE decks SET commander_id = ?, partner_id = ?, companion_id = ?, updated = ? WHERE id = ?",
            (values["commander_id"], values["partner_id"], values["companion_id"], _now(), deck_id),
        )
    return deck_id


def set_commander(user_id, deck_id, card_id):
    return set_deck_role(user_id, deck_id, card_id, "commander")


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


def deck_add(user_id, deck_id, card_id=None, quantity=1, card=None, zone="main", force_proxy=False):
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
        if force_proxy and existing and not existing["proxy"]:
            raise StoreError("This printing already uses owned copies in that deck. "
                             "Mark its existing row as proxy in the deck first, or choose another deck.")
        # Adding another copy to an existing proxy line keeps that line a proxy.
        # The user can deliberately switch it to an owned copy from its detail view.
        proxy = force_proxy or not owned or bool(existing and existing["proxy"])
        if proxy and not owned and not card and not (existing and existing["proxy"]):
            raise StoreError("That card is not in your collection.")

        if owned and zone == "main" and not proxy:
            held = _allocations(conn, user_id).get(card_id, [])
            allocated = sum(item["quantity"] for item in held)
            free = int(owned["quantity"]) - allocated
            if free < quantity:
                if card:
                    # A resolved lookup may intentionally add a proxy when the
                    # collection has no free copy left.
                    proxy = True
                else:
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
               DO UPDATE SET quantity = quantity + excluded.quantity,
                             proxy = CASE
                               WHEN excluded.proxy = 1 THEN 1
                               ELSE deck_cards.proxy
                             END""",
            (deck_id, card_id, quantity, zone, 1 if proxy else 0))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return {"deck_id": deck_id, "card_id": card_id, "proxy_added": proxy}


def change_deck_printing(user_id, deck_id, card_id, card):
    """Replace a deck row and its owned copies in one transaction."""
    if not isinstance(card, dict) or not card.get("id"):
        raise StoreError("Choose a printing first.")
    new_id = card["id"]
    with db.transaction() as conn:
        deck = _owned_deck(conn, user_id, deck_id)
        line = conn.execute(
            "SELECT * FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, card_id)).fetchone()
        if not line:
            raise StoreError("That card is no longer in the deck.")
        original = card_json(conn.execute("SELECT data FROM cards WHERE id = ?",
                                          (card_id,)).fetchone())
        same_card = (original["oracle_id"] == card.get("oracle_id")
                     if original.get("oracle_id") else
                     bool(original.get("name")) and original["name"] == card.get("name"))
        if not same_card:
            raise StoreError("Choose another printing of the same card.")
        if new_id == card_id:
            return deck_id
        target = conn.execute(
            "SELECT * FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, new_id)).fetchone()
        if target and (target["zone"] != line["zone"] or target["proxy"] != line["proxy"]):
            raise StoreError("That printing is already in a different zone or has a different proxy status.")
        quantity = int(line["quantity"])
        owned = conn.execute(
            "SELECT quantity, added FROM collection WHERE user_id = ? AND card_id = ?",
            (user_id, card_id)).fetchone()
        if not line["proxy"]:
            allocated_elsewhere = sum(item["quantity"] for item in
                _allocations(conn, user_id).get(card_id, []) if item["deck_id"] != deck_id)
            if not owned or int(owned["quantity"]) - allocated_elsewhere < quantity:
                raise StoreError("There are not enough unallocated collection copies to change this printing.")
        remember_card(card, conn)
        if not line["proxy"]:
            remaining = int(owned["quantity"]) - quantity
            if remaining:
                conn.execute("UPDATE collection SET quantity = ? WHERE user_id = ? AND card_id = ?",
                             (remaining, user_id, card_id))
            else:
                conn.execute("DELETE FROM collection WHERE user_id = ? AND card_id = ?",
                             (user_id, card_id))
            conn.execute(
                """INSERT INTO collection (user_id, card_id, quantity, added) VALUES (?, ?, ?, ?)
                   ON CONFLICT (user_id, card_id) DO UPDATE SET quantity = quantity + excluded.quantity""",
                (user_id, new_id, quantity, owned["added"]))
        conn.execute("DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?", (deck_id, card_id))
        conn.execute(
            """INSERT INTO deck_cards (deck_id, card_id, quantity, zone, proxy) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (deck_id, card_id) DO UPDATE SET quantity = quantity + excluded.quantity""",
            (deck_id, new_id, quantity, line["zone"], line["proxy"]))
        role_ids = [new_id if deck[key] == card_id else deck[key]
                    for key in ("commander_id", "partner_id", "companion_id")]
        conn.execute(
            "UPDATE decks SET commander_id = ?, partner_id = ?, companion_id = ?, updated = ? WHERE id = ?",
            (*role_ids, _now(), deck_id),
        )
    return deck_id


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
            conn.execute(
                """UPDATE decks SET
                     commander_id = CASE WHEN commander_id = ? THEN NULL ELSE commander_id END,
                     partner_id = CASE WHEN partner_id = ? THEN NULL ELSE partner_id END,
                     companion_id = CASE WHEN companion_id = ? THEN NULL ELSE companion_id END
                   WHERE id = ?""",
                (card_id, card_id, card_id, deck_id),
            )
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return deck_id


def set_proxy(user_id, deck_id, card_id, proxy):
    """Mark a deck card as a proxy, or replace it with an owned printing."""
    with db.transaction() as conn:
        deck = _owned_deck(conn, user_id, deck_id)
        line = conn.execute(
            "SELECT quantity, zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
            (deck_id, card_id),
        ).fetchone()
        if not line:
            raise StoreError("That card is no longer in the deck.")
        proxy = bool(proxy)
        replacement_id = card_id
        if not proxy:
            original = card_json(conn.execute(
                "SELECT data FROM cards WHERE id = ?", (card_id,)).fetchone())
            original_oracle = original.get("oracle_id")
            original_name = (original.get("name") or "").casefold()
            allocations = _allocations(conn, user_id)
            candidates = conn.execute(
                """SELECT c.card_id, c.quantity, k.data
                     FROM collection c JOIN cards k ON k.id = c.card_id
                    WHERE c.user_id = ?
                    ORDER BY CASE WHEN c.card_id = ? THEN 0 ELSE 1 END,
                             c.added, c.card_id""",
                (user_id, card_id),
            ).fetchall()
            for candidate in candidates:
                candidate_card = card_json(candidate)
                same_card = (candidate_card.get("oracle_id") == original_oracle
                             if original_oracle else
                             (candidate_card.get("name") or "").casefold() == original_name)
                if not same_card:
                    continue
                allocated = sum(item["quantity"] for item in
                                allocations.get(candidate["card_id"], []))
                if (line["zone"] == "main" and
                        int(candidate["quantity"]) - allocated < int(line["quantity"])):
                    continue
                target = conn.execute(
                    "SELECT proxy, zone FROM deck_cards WHERE deck_id = ? AND card_id = ?",
                    (deck_id, candidate["card_id"]),
                ).fetchone()
                if target and candidate["card_id"] != card_id and (
                        target["zone"] != line["zone"] or target["proxy"]):
                    continue
                replacement_id = candidate["card_id"]
                break
            else:
                raise StoreError(
                    "Add an available printing of this card to your collection before using an owned copy.")

            if replacement_id != card_id:
                conn.execute("DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?",
                             (deck_id, card_id))
                conn.execute(
                    """INSERT INTO deck_cards (deck_id, card_id, quantity, zone, proxy)
                       VALUES (?, ?, ?, ?, 0)
                       ON CONFLICT (deck_id, card_id)
                       DO UPDATE SET quantity = quantity + excluded.quantity""",
                    (deck_id, replacement_id, line["quantity"], line["zone"]),
                )
                conn.execute(
                    """UPDATE decks SET
                         commander_id = CASE WHEN commander_id = ? THEN ? ELSE commander_id END,
                         partner_id = CASE WHEN partner_id = ? THEN ? ELSE partner_id END,
                         companion_id = CASE WHEN companion_id = ? THEN ? ELSE companion_id END
                       WHERE id = ?""",
                    (card_id, replacement_id, card_id, replacement_id,
                     card_id, replacement_id, deck_id),
                )
            else:
                conn.execute("UPDATE deck_cards SET proxy = 0 WHERE deck_id = ? AND card_id = ?",
                             (deck_id, card_id))
        else:
            conn.execute("UPDATE deck_cards SET proxy = 1 WHERE deck_id = ? AND card_id = ?",
                         (deck_id, card_id))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return {"deck_id": deck_id, "card_id": replacement_id,
            "previous_card_id": card_id}


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
        if zone == "maybeboard":
            conn.execute(
                """UPDATE decks SET
                     commander_id = CASE WHEN commander_id = ? THEN NULL ELSE commander_id END,
                     partner_id = CASE WHEN partner_id = ? THEN NULL ELSE partner_id END
                   WHERE id = ?""",
                (card_id, card_id, deck_id),
            )
        elif deck["companion_id"] == card_id:
            conn.execute("UPDATE decks SET companion_id = NULL WHERE id = ?", (deck_id,))
        conn.execute("UPDATE decks SET updated = ? WHERE id = ?", (_now(), deck_id))
    return deck_id


# --------------------------------------------------------------- library

def _collection_value(user_id, conn):
    return conn.execute(
        """SELECT COALESCE(SUM(c.quantity *
               CAST(json_extract(k.data, '$.prices.usd') AS REAL)), 0) AS total
             FROM collection c JOIN cards k ON k.id = c.card_id
            WHERE c.user_id = ?""", (user_id,)
    ).fetchone()["total"]


def record_price_snapshot(user_id, conn=None):
    conn = conn or db.connect()
    value = float(_collection_value(user_id, conn) or 0)
    conn.execute(
        """INSERT INTO price_snapshots (user_id, day, collection_value) VALUES (?, ?, ?)
           ON CONFLICT (user_id, day) DO UPDATE SET collection_value = excluded.collection_value""",
        (user_id, datetime.date.today().isoformat(), value))
    return value


def price_history(user_id, conn=None):
    conn = conn or db.connect()
    current = record_price_snapshot(user_id, conn)
    rows = conn.execute(
        """SELECT day, collection_value FROM price_snapshots WHERE user_id = ?
           ORDER BY day DESC LIMIT 60""", (user_id,)).fetchall()
    return {"current": current, "history": [
        {"day": row["day"], "value": float(row["collection_value"])} for row in rows
    ]}


def price_refresh_due(user_id, conn=None):
    conn = conn or db.connect()
    row = conn.execute(
        "SELECT 1 FROM price_refreshes WHERE user_id = ? AND day = ?",
        (user_id, datetime.date.today().isoformat()),
    ).fetchone()
    return row is None


def collection_card_ids(user_id, conn=None):
    conn = conn or db.connect()
    return [row["card_id"] for row in conn.execute(
        """SELECT card_id FROM collection WHERE user_id = ?
           UNION
           SELECT dc.card_id FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
            WHERE d.user_id = ?
           ORDER BY card_id""", (user_id, user_id)
    )]


def refresh_collection_prices(user_id, cards, complete=True):
    """Save fresh Scryfall payloads, then mark this user's daily refresh complete."""
    with db.transaction() as conn:
        for card in cards:
            remember_card(card, conn)
        if complete:
            conn.execute(
                "INSERT OR IGNORE INTO price_refreshes (user_id, day) VALUES (?, ?)",
                (user_id, datetime.date.today().isoformat()),
            )
        record_price_snapshot(user_id, conn)


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
    value = _collection_value(user_id, conn)
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
    def line_value(line):
        try:
            return float((line["card"].get("prices") or {}).get("usd") or 0) * line["quantity"]
        except (TypeError, ValueError):
            return 0
    return {
        "id": row["id"], "name": row["name"], "created": row["created"],
        "updated": row["updated"], "category": row["category"],
        "commander_id": row["commander_id"], "partner_id": row["partner_id"],
        "companion_id": row["companion_id"],
        "cards": lines,
        "count": sum(line["quantity"] for line in lines if line["zone"] == "main"),
        "maybeboard_count": sum(line["quantity"] for line in lines if line["zone"] == "maybeboard"),
        "value": round(sum(line_value(line) for line in lines if line["zone"] == "main"), 2),
        "maybeboard_value": round(sum(line_value(line) for line in lines if line["zone"] == "maybeboard"), 2),
    }


def unowned_deck_cards(user_id, deck_id):
    """Main-deck shortfalls, counting owned copies across all printings.

    Ownership includes copies in other decks: this is a purchase estimate,
    not an allocation of the user's collection.
    """
    deck = deck_state(user_id, deck_id)
    if deck is None:
        raise StoreError("Deck not found.")
    needed = {}
    for line in deck["cards"]:
        if line["zone"] != "main":
            continue
        card = line["card"]
        key = card.get("name", "").casefold()
        item = needed.setdefault(key, {"card": card, "quantity": 0})
        item["quantity"] += line["quantity"]
    rows = db.connect().execute(
        """SELECT k.name, c.quantity FROM collection c
           JOIN cards k ON k.id = c.card_id WHERE c.user_id = ?""", (user_id,))
    for row in rows:
        key = row["name"].casefold()
        if key in needed:
            needed[key]["quantity"] -= int(row["quantity"])
    return [item for item in needed.values() if item["quantity"] > 0]


def patch(user_id, entry_ids=(), deck_ids=()):
    """The small, self-consistent state change returned after a mutation."""
    conn = db.connect()
    entries = [item for card_id in dict.fromkeys(entry_ids)
               if (item := entry_state(user_id, card_id, conn)) is not None]
    decks = [deck for deck_id in dict.fromkeys(deck_ids)
             if (deck := deck_state(user_id, deck_id, conn)) is not None]
    record_price_snapshot(user_id, conn)
    return {"entries": entries, "decks": decks, "wishlist": wishlist(user_id, conn),
            "summary": summary(user_id, conn)}

def library(user_id):
    """One consistent snapshot: collection, decks, and who holds what."""
    conn = db.connect()
    record_price_snapshot(user_id, conn)
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

    return {"entries": owned, "decks": decks, "wishlist": wishlist(user_id, conn),
            "summary": summary(user_id, conn)}


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
        "wishlist": [
            {"card": item["card"], "quantity": item["manual_quantity"]}
            for item in snapshot["wishlist"] if item["manual_quantity"]
        ],
        "decks": [
            {
                "name": deck["name"],
                "category": deck["category"],
                "commander_id": deck["commander_id"],
                "partner_id": deck["partner_id"],
                "companion_id": deck["companion_id"],
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
    if profile.get("format") != PROFILE_FORMAT or profile.get("version") not in (1, 2, 3, PROFILE_VERSION):
        raise StoreError("That profile is from an unsupported version of MTG Card Viewer.")
    if mode not in ("merge", "replace"):
        raise StoreError("Choose whether to add to or replace your collection.")
    collection = profile.get("collection")
    decks = profile.get("decks")
    wishes = profile.get("wishlist", [])
    if not isinstance(collection, list) or not isinstance(decks, list) or not isinstance(wishes, list):
        raise StoreError("That profile backup is incomplete.")

    report = {
        "cards": 0, "printings": 0, "decks": 0,
        "skipped_cards": 0, "skipped_deck_cards": 0,
    }
    with db.transaction() as conn:
        if mode == "replace":
            conn.execute("DELETE FROM decks WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM collection WHERE user_id = ?", (user_id,))
            conn.execute("DELETE FROM wishlist WHERE user_id = ?", (user_id,))
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

        for item in wishes:
            card = item.get("card") if isinstance(item, dict) else None
            quantity = _profile_quantity(item.get("quantity")) if isinstance(item, dict) else 0
            if not isinstance(card, dict) or not card.get("id") or not quantity:
                report["skipped_cards"] += 1
                continue
            card_id = remember_card(card, conn)
            conn.execute(
                """INSERT INTO wishlist (user_id, card_id, quantity, added)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT (user_id, card_id)
                   DO UPDATE SET quantity = quantity + excluded.quantity""",
                (user_id, card_id, quantity, _now()),
            )

        allocations = _allocations(conn, user_id)
        for source_deck in decks:
            if not isinstance(source_deck, dict) or not isinstance(source_deck.get("cards"), list):
                report["skipped_deck_cards"] += 1
                continue
            deck_id = uuid.uuid4().hex
            now = _now()
            conn.execute(
                """INSERT INTO decks (id, user_id, name, category, commander_id, created, updated)
                   VALUES (?, ?, ?, ?, NULL, ?, ?)""",
                (deck_id, user_id, _clean_name(source_deck.get("name")),
                 _clean_category(source_deck.get("category")), now, now),
            )
            card_zones = {}
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
                    card_zones[card_id] = zone
                else:
                    card_zones[card_id] = zone

            commander_id = source_deck.get("commander_id")
            partner_id = source_deck.get("partner_id")
            companion_id = source_deck.get("companion_id")
            commander_id = commander_id if card_zones.get(commander_id) == "main" else None
            partner_id = partner_id if card_zones.get(partner_id) == "main" else None
            companion_id = companion_id if card_zones.get(companion_id) == "maybeboard" else None
            if partner_id == commander_id:
                partner_id = None
            if companion_id in (commander_id, partner_id):
                companion_id = None
            conn.execute(
                "UPDATE decks SET commander_id = ?, partner_id = ?, companion_id = ? WHERE id = ?",
                (commander_id, partner_id, companion_id, deck_id),
            )
            report["decks"] += 1
    return report

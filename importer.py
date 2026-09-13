"""Turn a pasted list or an exported file into cards for the collection.

Handles the two shapes people actually have to hand:

  * a decklist, one card per line, in any of the usual dialects -
    "4 Lightning Bolt", "4x Lightning Bolt", "1 Sol Ring (LTC) 284 *F*"
  * a CSV export from a collection site (Archidekt, Moxfield and friends),
    matched by column name rather than by column position

Resolution goes through Scryfall's batch endpoint, so a long list costs a
couple of requests rather than one per card.
"""

from __future__ import annotations

import csv
import io
import re

import scryfall

MAX_LINES = 2000
MAX_FUZZY = 25  # individual look-ups for names the batch could not match

# Section markers and comments in decklist exports.
SKIP_LINES = {
    "deck", "sideboard", "commander", "companion", "maybeboard",
    "considering", "tokens", "main", "mainboard",
}

LINE = re.compile(
    r"""^\s*
        (?:(?P<qty>\d{1,4})\s*[xX]?\s+)?        # "4 " or "4x "
        (?P<name>.+?)                            # the card name
        (?:\s+[\(\[](?P<set>[A-Za-z0-9_]{2,6})[\)\]]   # "(LTC)" or "[LTC]"
           (?:\s+(?P<cn>[A-Za-z0-9★-]+))?         # "284"
        )?
        (?P<flags>(?:\s+\*[^*]*\*)*)             # Arena's "*F*" foil marker
        \s*$""",
    re.VERBOSE,
)

# CSV headers vary by site; match on meaning, not position.
COLUMNS = {
    "quantity": ("quantity", "count", "qty", "amount", "number"),
    "name": ("name", "card name", "card"),
    "set": ("edition code", "set code", "setcode", "set", "edition", "expansion"),
    "collector_number": ("collector number", "collector_number", "card number",
                         "cardnumber", "number in set"),
    "scryfall_id": ("scryfall id", "scryfall_id", "scryfallid", "id"),
}


class ImportError_(Exception):
    """The text could not be read as a card list at all."""


def _blank(value):
    return value is None or not str(value).strip()


def looks_like_csv(text):
    """A header row naming a card column is the giveaway."""
    first = next((line for line in text.splitlines() if line.strip()), "")
    if first.count(",") < 1:
        return False
    cells = [cell.strip().strip('"').lower() for cell in first.split(",")]
    return any(cell in COLUMNS["name"] for cell in cells)


def _column_map(header):
    found = {}
    for index, cell in enumerate(header):
        key = cell.strip().strip('"').lower()
        for field, aliases in COLUMNS.items():
            if key in aliases and field not in found:
                found[field] = index
    return found


def parse_csv(text):
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise ImportError_("That file has no rows.")
    columns = _column_map(rows[0])
    if "name" not in columns and "scryfall_id" not in columns:
        raise ImportError_(
            "No 'Name' or 'Scryfall ID' column found in that CSV's header row.")

    entries, problems = [], []
    for row in rows[1:len(rows)][:MAX_LINES]:
        if not any(cell.strip() for cell in row):
            continue

        def cell(field):
            index = columns.get(field)
            if index is None or index >= len(row):
                return None
            value = row[index].strip()
            return value or None

        quantity = cell("quantity")
        try:
            quantity = max(1, int(float(quantity))) if quantity else 1
        except ValueError:
            quantity = 1

        entry = {
            "quantity": quantity,
            "name": cell("name"),
            "set": (cell("set") or "").lower() or None,
            "collector_number": cell("collector_number"),
            "scryfall_id": cell("scryfall_id"),
            "line": ",".join(row)[:120],
        }
        if _blank(entry["name"]) and _blank(entry["scryfall_id"]):
            problems.append({"line": entry["line"], "reason": "No card name in this row"})
            continue
        entries.append(entry)
    return entries, problems


def parse_list(text):
    entries, problems = [], []
    for raw in text.splitlines()[:MAX_LINES]:
        line = raw.strip()
        if not line or line.startswith("//") or line.startswith("#"):
            continue
        if line.lower().rstrip(":") in SKIP_LINES:
            continue

        match = LINE.match(line)
        if not match:
            problems.append({"line": line[:120], "reason": "Could not read this line"})
            continue

        name = (match.group("name") or "").strip().strip('"')
        # "Deck (60)" style headers slip past the section check
        if not name or name.lower().rstrip(":") in SKIP_LINES:
            continue

        entries.append({
            "quantity": max(1, int(match.group("qty") or 1)),
            "name": name,
            "set": (match.group("set") or "").lower() or None,
            "collector_number": match.group("cn"),
            "scryfall_id": None,
            "line": line[:120],
        })
    return entries, problems


def parse(text):
    """Read `text` as either a CSV export or a plain decklist."""
    if not text or not text.strip():
        raise ImportError_("Nothing to import - paste a list first.")
    entries, problems = (parse_csv(text) if looks_like_csv(text) else parse_list(text))
    if not entries and not problems:
        raise ImportError_("No cards found in that text.")
    return _merge(entries), problems


def _merge(entries):
    """Fold repeats of the same printing into one line."""
    merged = {}
    for entry in entries:
        key = (entry["scryfall_id"] or "",
               (entry["name"] or "").lower(),
               entry["set"] or "",
               entry["collector_number"] or "")
        if key in merged:
            merged[key]["quantity"] += entry["quantity"]
        else:
            merged[key] = entry
    return list(merged.values())


def _identifier(entry):
    if entry["scryfall_id"]:
        return {"id": entry["scryfall_id"]}
    if entry["set"] and entry["collector_number"]:
        return {"set": entry["set"], "collector_number": entry["collector_number"]}
    if entry["set"] and entry["name"]:
        # "3 Forest [M10]" still deserves the M10 printing
        return {"name": entry["name"], "set": entry["set"]}
    return {"name": entry["name"]}


def _index(cards):
    """Look-ups for matching a batch response back onto the lines that asked."""
    by_id, by_print, by_name, by_name_set = {}, {}, {}, {}
    for card in cards:
        by_id[card["id"]] = card
        by_print[((card.get("set") or "").lower(),
                  str(card.get("collector_number") or "").lower())] = card
        by_name_set.setdefault(((card.get("name") or "").lower(),
                                (card.get("set") or "").lower()), card)
        by_name.setdefault((card.get("name") or "").lower(), card)
        # split cards answer to their front half too ("Fire" for "Fire // Ice")
        front = (card.get("name") or "").split(" // ")[0].lower()
        by_name.setdefault(front, card)
    return by_id, by_print, by_name, by_name_set


def _names_agree(card, name):
    """Does this card answer to the name the list asked for?"""
    if not name:
        return True
    wanted = name.strip().lower()
    actual = (card.get("name") or "").lower()
    return (wanted == actual
            or wanted == actual.split(" // ")[0]
            or actual.startswith(wanted + " // "))


def resolve(entries):
    """Attach a Scryfall card to each entry; report the ones that miss."""
    if not entries:
        return [], []
    cards, _ = scryfall.cards_by_identifiers([_identifier(e) for e in entries])
    by_id, by_print, by_name, by_name_set = _index(cards)

    resolved, missing = [], []
    retry = []
    for entry in entries:
        card, note = None, None
        if entry["scryfall_id"]:
            card = by_id.get(entry["scryfall_id"])  # an id is authoritative
        elif entry["set"] and entry["collector_number"]:
            card = by_print.get((entry["set"], str(entry["collector_number"]).lower()))
            if card is not None and not _names_agree(card, entry["name"]):
                # The set and number point at a different card than the name
                # does - a stale export or a typo.  Believe the name.
                note = "%s %s is %s, not %s - matched by name instead" % (
                    (entry["set"] or "").upper(), entry["collector_number"],
                    card.get("name"), entry["name"])
                card = None
        elif entry["set"] and entry["name"]:
            card = by_name_set.get((entry["name"].lower(), entry["set"]))
        if card is None and entry["name"]:
            card = by_name.get(entry["name"].lower())
        if card is None:
            entry["note"] = note
            retry.append(entry)
        else:
            resolved.append({"entry": entry, "card": card, "note": note})

    # Anything the exact batch missed gets one fuzzy look-up each - enough to
    # rescue punctuation and near-misses without stalling on a bad paste.
    for entry in retry[:MAX_FUZZY]:
        if not entry["name"]:
            missing.append({"line": entry["line"], "reason": "No name to search for"})
            continue
        try:
            card = scryfall.card_by_name(entry["name"])
        except scryfall.ScryfallError as exc:
            missing.append({"line": entry["line"], "reason": str(exc)})
            continue
        resolved.append({"entry": entry, "card": card, "fuzzy": True,
                         "note": entry.get("note")})

    for entry in retry[MAX_FUZZY:]:
        missing.append({"line": entry["line"], "reason": "Not found"})
    return resolved, missing


def preview(text):
    """Parse and resolve without writing anything."""
    entries, problems = parse(text)
    resolved, missing = resolve(entries)
    items = [
        {
            "id": item["card"]["id"],
            "name": item["card"]["name"],
            "set": item["card"].get("set"),
            "set_name": item["card"].get("set_name"),
            "collector_number": item["card"].get("collector_number"),
            "quantity": item["entry"]["quantity"],
            "fuzzy": bool(item.get("fuzzy")),
            "note": item.get("note"),
            "asked": item["entry"]["line"],
        }
        for item in resolved
    ]
    return {
        "items": items,
        "problems": problems + missing,
        "total": sum(item["quantity"] for item in items),
        "unique": len(items),
    }, resolved

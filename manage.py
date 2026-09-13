#!/usr/bin/env python3
"""Admin commands for the server.  Run these on the Pi.

    python manage.py initdb
    python manage.py adduser will
    python manage.py passwd will
    python manage.py users
    python manage.py deluser dave
    python manage.py import-json will [folder]
    python manage.py export-json will ./backup
    python manage.py stats
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys

import auth
import db
import store


def _prompt_password(confirm=True):
    password = getpass.getpass("Password: ")
    if confirm and password != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match.")
    return password


def cmd_initdb(_args):
    db.migrate()
    print("Database ready at %s" % db.db_path())
    if not auth.any_users():
        print("No accounts yet — create one with:  python manage.py adduser <name>")


def cmd_adduser(args):
    db.migrate()
    password = args.password or _prompt_password()
    try:
        user_id = auth.create_user(args.username, password, is_admin=args.admin)
    except ValueError as exc:
        sys.exit(str(exc))
    print("Created %s (id %d)%s" % (args.username, user_id, " — admin" if args.admin else ""))


def cmd_passwd(args):
    db.migrate()
    try:
        auth.set_password(args.username, args.password or _prompt_password())
    except ValueError as exc:
        sys.exit(str(exc))
    print("Password updated for %s" % args.username)


def cmd_users(_args):
    db.migrate()
    rows = auth.list_users()
    if not rows:
        print("No accounts yet.")
        return
    print("%-4s %-22s %-7s %s" % ("id", "username", "admin", "created"))
    for row in rows:
        counts = store.library(row["id"])["summary"]
        print("%-4d %-22s %-7s %s  (%d cards, %d decks)" % (
            row["id"], row["username"], "yes" if row["is_admin"] else "",
            row["created"], counts["total"], counts["decks"]))


def cmd_deluser(args):
    db.migrate()
    if not args.yes:
        confirm = input("Delete %s and everything they own? [y/N] " % args.username)
        if confirm.strip().lower() not in ("y", "yes"):
            sys.exit("Cancelled.")
    print("Deleted %s" % args.username if auth.delete_user(args.username)
          else "No such user: %s" % args.username)


def _load_json_folder(folder):
    """Read the desktop app's Documents folder: cards/*.json and decks/*.json."""
    cards_dir = os.path.join(folder, "cards")
    decks_dir = os.path.join(folder, "decks")
    if not os.path.isdir(cards_dir):
        sys.exit("No 'cards' folder inside %s" % folder)

    cards, decks = [], []
    for name in sorted(os.listdir(cards_dir)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(cards_dir, name), encoding="utf-8") as handle:
                entry = json.load(handle)
        except (OSError, ValueError):
            print("  skipped unreadable %s" % name)
            continue
        if entry.get("card") and entry.get("id"):
            cards.append(entry)
    if os.path.isdir(decks_dir):
        for name in sorted(os.listdir(decks_dir)):
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(decks_dir, name), encoding="utf-8") as handle:
                    decks.append(json.load(handle))
            except (OSError, ValueError):
                print("  skipped unreadable deck %s" % name)
    return cards, decks


def cmd_import_json(args):
    db.migrate()
    user = auth.find_user(args.username)
    if not user:
        sys.exit("No such user: %s" % args.username)

    folder = args.folder or db.data_dir()
    print("Reading %s" % folder)

    cards, decks = _load_json_folder(folder)
    added = store.add_many(user["id"], [(c["card"], c.get("quantity", 1)) for c in cards])
    print("  imported %d cards across %d printings" % (added, len(cards)))

    for deck in decks:
        deck_id = store.create_deck(user["id"], deck.get("name") or "Imported deck")
        placed = 0
        for card_id, quantity in (deck.get("cards") or {}).items():
            try:
                store.deck_add(user["id"], deck_id, card_id, int(quantity))
                placed += int(quantity)
            except store.StoreError as exc:
                print("    %s: %s" % (deck.get("name"), exc))
        if deck.get("commander_id"):
            try:
                store.set_commander(user["id"], deck_id, deck["commander_id"])
            except store.StoreError as exc:
                print("    %s: %s" % (deck.get("name"), exc))
        print("  deck %-28s %d cards" % (deck.get("name", "?"), placed))
    print("Done.")


def cmd_export_json(args):
    """Write a user's library back out as the same loose JSON the app used."""
    db.migrate()
    user = auth.find_user(args.username)
    if not user:
        sys.exit("No such user: %s" % args.username)

    cards_dir = os.path.join(args.folder, "cards")
    decks_dir = os.path.join(args.folder, "decks")
    os.makedirs(cards_dir, exist_ok=True)
    os.makedirs(decks_dir, exist_ok=True)

    snapshot = store.library(user["id"])
    for entry in snapshot["entries"]:
        payload = {k: entry[k] for k in
                   ("id", "name", "set", "set_name", "collector_number",
                    "rarity", "quantity", "added", "card")}
        with open(os.path.join(cards_dir, entry["id"] + ".json"), "w",
                  encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    for deck in snapshot["decks"]:
        payload = {
            "id": deck["id"], "name": deck["name"], "created": deck["created"],
            "updated": deck["updated"], "commander_id": deck["commander_id"],
            "cards": {line["card_id"]: line["quantity"] for line in deck["cards"]},
        }
        with open(os.path.join(decks_dir, deck["id"] + ".json"), "w",
                  encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
    print("Wrote %d cards and %d decks to %s"
          % (len(snapshot["entries"]), len(snapshot["decks"]), args.folder))


def cmd_stats(_args):
    db.migrate()
    conn = db.connect()
    cards = conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"]
    users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    size = os.path.getsize(db.db_path()) / 1024.0
    print("database   %s (%.0f KB)" % (db.db_path(), size))
    print("accounts   %d" % users)
    print("card cache %d printings" % cards)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = parser.add_subparsers(dest="command", required=True)

    subs.add_parser("initdb", help="create or upgrade the database").set_defaults(func=cmd_initdb)

    p = subs.add_parser("adduser", help="create an account")
    p.add_argument("username")
    p.add_argument("--password", help="skip the prompt (visible in shell history)")
    p.add_argument("--admin", action="store_true")
    p.set_defaults(func=cmd_adduser)

    p = subs.add_parser("passwd", help="change a password")
    p.add_argument("username")
    p.add_argument("--password")
    p.set_defaults(func=cmd_passwd)

    subs.add_parser("users", help="list accounts").set_defaults(func=cmd_users)

    p = subs.add_parser("deluser", help="delete an account and all its data")
    p.add_argument("username")
    p.add_argument("--yes", action="store_true", help="skip the confirmation")
    p.set_defaults(func=cmd_deluser)

    p = subs.add_parser("import-json", help="load the desktop app's Documents folder")
    p.add_argument("username")
    p.add_argument("folder", nargs="?", help="defaults to Documents/MTG Card Viewer")
    p.set_defaults(func=cmd_import_json)

    p = subs.add_parser("export-json", help="write a library back out as JSON files")
    p.add_argument("username")
    p.add_argument("folder")
    p.set_defaults(func=cmd_export_json)

    subs.add_parser("stats", help="database summary").set_defaults(func=cmd_stats)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

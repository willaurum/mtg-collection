"""Flask backend for the card viewer.

Serves the single-page UI, proxies the handful of Scryfall calls it needs, and
caches every image on disk.  Storage is SQLite and every route is scoped to the
signed-in account, so one instance on a Raspberry Pi can hold several people's
collections without them seeing each other's.
"""

from __future__ import annotations

import collections as collections_abc
import os
import subprocess
import sys
import secrets
import uuid
import webbrowser
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor

from flask import (Flask, Response, g, jsonify, redirect, render_template,
                   request, session, url_for)

import auth
import db
import importer
import scryfall
import store

# PyInstaller unpacks the bundle to a temp dir; templates and static live there.
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)
auth.configure(app)
db.migrate()

# A single-user desktop launch skips the login form: there is nobody else on
# the machine to keep out, and the data never leaves it.
LOCAL_USER = os.environ.get("MTG_LOCAL_USER") or None


@app.before_request
def _local_autologin():
    if LOCAL_USER and auth.current_user() is None:
        user = auth.find_user(LOCAL_USER)
        if user:
            auth.log_in(user)
            g.user = user


@app.after_request
def _no_store(response):
    """The window is reloaded constantly during development; never cache the shell."""
    if response.mimetype in ("text/html", "text/css", "application/javascript"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/")
@auth.login_required
def index():
    return render_template("index.html", username=auth.current_user()["username"])


@app.route("/login", methods=["GET", "POST"])
def login():
    """Sign-in form.  Accounts are made on the server with manage.py."""
    target = request.values.get("next") or "/"
    if not target.startswith("/") or target.startswith("//"):
        target = "/"                      # never redirect off-site

    if auth.current_user() is not None:
        return redirect(target)

    if "csrf" not in session:
        session["csrf"] = uuid.uuid4().hex

    error = None
    username = ""
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        if not secrets.compare_digest(request.form.get("csrf", ""), session["csrf"]):
            error = "That form expired. Try again."
        elif auth.locked_out(username):
            error = ("Too many attempts. Wait %d seconds."
                     % auth.locked_out(username))
        else:
            user = auth.authenticate(username, request.form.get("password"))
            if user:
                auth.clear_failures(username)
                auth.log_in(user)
                return redirect(target)
            auth.note_failure(username)
            error = "Wrong username or password."

    return render_template("login.html", error=error, username=username,
                           next_url=target, csrf=session["csrf"],
                           no_accounts=not auth.any_users()), (200 if not error else 401)


@app.post("/logout")
@auth.api_login_required
def logout():
    auth.log_out()
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    user = auth.current_user()
    return jsonify({"user": user["username"] if user else None,
                    "auth": user is not None})


def _card_response(fetch):
    try:
        return jsonify(fetch())
    except scryfall.ScryfallError as exc:
        return jsonify({"error": str(exc), "suggestions": exc.suggestions}), 404


@app.get("/api/card")
@auth.api_login_required
def api_card():
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Type a card name first."}), 400
    return _card_response(lambda: scryfall.card_by_name(name))


@app.get("/api/random")
@auth.api_login_required
def api_random():
    return _card_response(scryfall.random_card)


@app.get("/api/autocomplete")
@auth.api_login_required
def api_autocomplete():
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return jsonify([])
    return jsonify(scryfall.autocomplete(query)[:9])


@app.get("/api/printings")
@auth.api_login_required
def api_printings():
    uri = request.args.get("uri") or ""
    try:
        return jsonify(scryfall.printings_by_uri(uri))
    except scryfall.ScryfallError as exc:
        return jsonify({"error": str(exc)}), 400


def _library(**extra):
    """The complete snapshot, used for the initial load and explicit refreshes."""
    payload = store.library(auth.user_id())
    payload.update(extra)
    return jsonify(payload)


def _refresh_current_prices(user_id, force=False):
    """Refresh every printing a user owns or plays, at most once per day."""
    refreshed = False
    stale = False
    if force or store.price_refresh_due(user_id):
        try:
            cards, missing = scryfall.cards_by_identifiers(
                [{"id": card_id} for card_id in store.collection_card_ids(user_id)]
            )
            store.refresh_collection_prices(user_id, cards, complete=not missing)
            refreshed = True
            stale = bool(missing)
        except (scryfall.ScryfallError, TimeoutError):
            # A history based on the last cached prices is still more helpful
            # than an error modal when the Pi temporarily has no internet.
            stale = True
    return {"prices_refreshed": refreshed, "prices_stale": stale}


def _patch_response(entry_ids=(), removed_entry_ids=(), deck_ids=(),
                    removed_deck_ids=(), entry_id=None, **extra):
    """Return just the records changed by a successful mutation."""
    payload = store.patch(auth.user_id(), entry_ids, deck_ids)
    payload.update({
        "removed_entries": list(dict.fromkeys(removed_entry_ids)),
        "removed_decks": list(dict.fromkeys(removed_deck_ids)),
    })
    if entry_id is not None:
        payload["entry"] = next((item for item in payload["entries"]
                                 if item["id"] == entry_id), None)
    payload.update(extra)
    return jsonify(payload)


def _store_call(work, changed):
    """Run a store operation and return its compact state patch."""
    try:
        result = work()
    except store.StoreError as exc:
        return jsonify({"error": str(exc)}), 409
    except (OSError, ValueError) as exc:
        return jsonify({"error": "Could not save that: %s" % exc}), 500
    return _patch_response(**changed(result))


@app.get("/api/library")
@auth.api_login_required
def api_library():
    return _library()


@app.get("/api/prices/history")
@auth.api_login_required
def api_price_history():
    user_id = auth.user_id()
    refresh = _refresh_current_prices(user_id)
    payload = store.price_history(user_id)
    payload.update({"refreshed": refresh["prices_refreshed"], "stale": refresh["prices_stale"]})
    return jsonify(payload)


@app.get("/api/prices/refresh")
@auth.api_login_required
def api_price_refresh():
    return _library(**_refresh_current_prices(auth.user_id()))


@app.post("/api/prices/refresh")
@auth.api_login_required
def api_price_force_refresh():
    user_id = auth.user_id()
    refresh = _refresh_current_prices(user_id, force=True)
    scryfall.clear_cheapest_price_cache()
    # Warm every deck's missing-card estimate, including decks not currently open.
    cards = {}
    for deck in store.library(user_id)["decks"]:
        for item in store.unowned_deck_cards(user_id, deck["id"]):
            card = item["card"]
            cards[card.get("oracle_id") or card["name"]] = card
    def lookup(card):
        try:
            scryfall.cheapest_printing_usd(card)
            return True
        except (scryfall.ScryfallError, TimeoutError):
            return False
    with ThreadPoolExecutor(max_workers=4) as executor:
        if not all(list(executor.map(lookup, cards.values()))):
            refresh["prices_stale"] = True
    return _library(**refresh)


@app.get("/api/profile/export")
@auth.api_login_required
def api_profile_export():
    """Downloadable data only: account credentials never leave the server."""
    return jsonify(store.export_profile(auth.user_id()))


@app.post("/api/profile/import")
@auth.api_login_required
def api_profile_import():
    payload = request.get_json(silent=True) or {}
    profile = payload.get("profile")
    try:
        report = store.import_profile(auth.user_id(), profile, payload.get("mode", "merge"))
    except store.StoreError as exc:
        return jsonify({"error": str(exc)}), 400
    except (OSError, ValueError) as exc:
        return jsonify({"error": "Could not import that profile: %s" % exc}), 500
    return _library(imported_profile=report)


@app.post("/api/collection/add")
@auth.api_login_required
def api_collection_add():
    payload = request.get_json(silent=True) or {}
    card = payload.get("card") or {}
    if not card.get("id"):
        return jsonify({"error": "No card to add."}), 400
    return _store_call(lambda: store.add_card(
        auth.user_id(), card, int(payload.get("quantity", 1))),
        lambda entry: {"entry_ids": [entry["id"]], "entry_id": entry["id"]})


@app.post("/api/collection/remove")
@auth.api_login_required
def api_collection_remove():
    payload = request.get_json(silent=True) or {}
    card_id = payload.get("id")
    if not card_id:
        return jsonify({"error": "No card to remove."}), 400
    return _store_call(lambda: store.remove_card(
        auth.user_id(), card_id, bool(payload.get("all"))),
        lambda entry: ({"entry_ids": [entry["id"]], "entry_id": entry["id"]}
                       if entry else {"removed_entry_ids": [card_id], "entry_id": card_id}))


@app.get("/api/decks/<deck_id>/unowned-price")
@auth.api_login_required
def api_deck_unowned_price(deck_id):
    try:
        missing = store.unowned_deck_cards(auth.user_id(), deck_id)
    except store.StoreError as exc:
        return jsonify(error=str(exc)), 404
    total = Decimal("0")
    unpriced = 0
    def lookup(item):
        try:
            return scryfall.cheapest_printing_usd(item["card"])
        except (scryfall.ScryfallError, TimeoutError):
            return None
    # Keep a large deck's initial lookup responsive. Scryfall's shared
    # throttle still spaces every request, including pagination requests.
    with ThreadPoolExecutor(max_workers=4) as executor:
        for item, price in zip(missing, executor.map(lookup, missing)):
            if price is None:
                unpriced += item["quantity"]
            else:
                total += price * item["quantity"]
    return jsonify(value=float(total.quantize(Decimal("0.01"))),
                   missing_count=sum(item["quantity"] for item in missing),
                   unpriced_count=unpriced)


@app.post("/api/decks/create")
@auth.api_login_required
def api_deck_create():
    payload = request.get_json(silent=True) or {}
    return _store_call(lambda: store.create_deck(
        auth.user_id(), payload.get("name") or store.DEFAULT_DECK_NAME),
        lambda deck_id: {"deck_ids": [deck_id], "deck_id": deck_id})


@app.post("/api/decks/rename")
@auth.api_login_required
def api_deck_rename():
    payload = request.get_json(silent=True) or {}
    deck_id = payload.get("id")
    return _store_call(lambda: store.rename_deck(
        auth.user_id(), deck_id, payload.get("name")),
        lambda changed_id: {"entry_ids": store.deck_card_ids(auth.user_id(), changed_id),
                            "deck_ids": [changed_id], "deck_id": changed_id})


@app.post("/api/decks/category")
@auth.api_login_required
def api_deck_category():
    payload = request.get_json(silent=True) or {}
    deck_id = payload.get("id")
    return _store_call(lambda: store.set_deck_category(
        auth.user_id(), deck_id, payload.get("category")),
        lambda changed_id: {"deck_ids": [changed_id], "deck_id": changed_id})


@app.post("/api/decks/delete")
@auth.api_login_required
def api_deck_delete():
    payload = request.get_json(silent=True) or {}
    deck_id = payload.get("id")
    return _store_call(lambda: store.delete_deck(auth.user_id(), deck_id),
        lambda released: {"entry_ids": released, "removed_deck_ids": [deck_id]})


@app.post("/api/decks/commander")
@auth.api_login_required
def api_deck_commander():
    payload = request.get_json(silent=True) or {}
    return _store_call(lambda: store.set_commander(
        auth.user_id(), payload.get("deck_id"), payload.get("card_id")),
        lambda deck_id: {"deck_ids": [deck_id], "deck_id": deck_id})


@app.post("/api/decks/add")
@auth.api_login_required
def api_deck_add():
    payload = request.get_json(silent=True) or {}
    return _store_call(lambda: store.deck_add(
        auth.user_id(), payload.get("deck_id"), payload.get("card_id"),
        int(payload.get("quantity", 1)), payload.get("card"), payload.get("zone", "main")),
        lambda result: {"entry_ids": [result["card_id"]],
                        "deck_ids": [result["deck_id"]], "deck_id": result["deck_id"],
                        "proxy_added": result["proxy_added"]})


@app.post("/api/decks/remove")
@auth.api_login_required
def api_deck_remove():
    payload = request.get_json(silent=True) or {}
    return _store_call(lambda: store.deck_remove(
        auth.user_id(), payload.get("deck_id"), payload.get("card_id"),
        bool(payload.get("all"))),
        lambda deck_id: {"entry_ids": [payload.get("card_id")],
                         "deck_ids": [deck_id], "deck_id": deck_id})


@app.post("/api/decks/proxy")
@auth.api_login_required
def api_deck_proxy():
    payload = request.get_json(silent=True) or {}
    return _store_call(lambda: store.set_proxy(
        auth.user_id(), payload.get("deck_id"), payload.get("card_id"), payload.get("proxy")),
        lambda deck_id: {"entry_ids": [payload.get("card_id")],
                         "deck_ids": [deck_id], "deck_id": deck_id})


@app.post("/api/decks/move")
@auth.api_login_required
def api_deck_move():
    payload = request.get_json(silent=True) or {}
    return _store_call(lambda: store.move_deck_card(
        auth.user_id(), payload.get("deck_id"), payload.get("card_id"), payload.get("zone")),
        lambda deck_id: {"entry_ids": [payload.get("card_id")],
                         "deck_ids": [deck_id], "deck_id": deck_id})


# Preview resolves a list against Scryfall; the commit reuses that work.
# Tokens are namespaced by user so one account can never commit another's.
_pending_imports = collections_abc.OrderedDict()
_pending_deck_imports = collections_abc.OrderedDict()
MAX_PENDING_IMPORTS = 12


@app.post("/api/collection/import/preview")
@auth.api_login_required
def api_import_preview():
    text = (request.get_json(silent=True) or {}).get("text") or ""
    try:
        report, resolved = importer.preview(text)
    except importer.ImportError_ as exc:
        return jsonify({"error": str(exc)}), 400
    except scryfall.ScryfallError as exc:
        return jsonify({"error": "Scryfall could not be reached: %s" % exc}), 502

    token = uuid.uuid4().hex
    _pending_imports[(auth.user_id(), token)] = resolved
    while len(_pending_imports) > MAX_PENDING_IMPORTS:
        _pending_imports.popitem(last=False)
    report["token"] = token
    return jsonify(report)


@app.post("/api/collection/import/commit")
@auth.api_login_required
def api_import_commit():
    token = (request.get_json(silent=True) or {}).get("token")
    resolved = _pending_imports.pop((auth.user_id(), token), None)
    if resolved is None:
        return jsonify({"error": "That preview has expired - preview again."}), 409
    try:
        added = store.add_many(
            auth.user_id(),
            [(item["card"], item["entry"]["quantity"]) for item in resolved])
    except (OSError, ValueError) as exc:
        return jsonify({"error": "Import failed: %s" % exc}), 500
    return _patch_response(
        entry_ids=[item["card"]["id"] for item in resolved], imported=added)


@app.post("/api/decks/import/preview")
@auth.api_login_required
def api_deck_import_preview():
    text = (request.get_json(silent=True) or {}).get("text") or ""
    try:
        report, resolved = importer.preview(text)
    except importer.ImportError_ as exc:
        return jsonify({"error": str(exc)}), 400
    except scryfall.ScryfallError as exc:
        return jsonify({"error": "Scryfall could not be reached: %s" % exc}), 502

    token = uuid.uuid4().hex
    _pending_deck_imports[(auth.user_id(), token)] = resolved
    while len(_pending_deck_imports) > MAX_PENDING_IMPORTS:
        _pending_deck_imports.popitem(last=False)
    report["token"] = token
    return jsonify(report)


@app.post("/api/decks/import/commit")
@auth.api_login_required
def api_deck_import_commit():
    payload = request.get_json(silent=True) or {}
    token = payload.get("token")
    resolved = _pending_deck_imports.pop((auth.user_id(), token), None)
    if resolved is None:
        return jsonify({"error": "That deck preview has expired - preview again."}), 409
    try:
        report = store.import_deck(auth.user_id(), payload.get("name"), resolved,
                                   payload.get("mode"))
    except store.StoreError as exc:
        return jsonify({"error": str(exc)}), 400
    except (OSError, ValueError) as exc:
        return jsonify({"error": "Deck import failed: %s" % exc}), 500
    return _library(imported_deck=report)


@app.post("/api/collection/open")
@auth.api_login_required
def api_collection_open():
    """Reveal the data folder — only meaningful when the app runs locally."""
    if not LOCAL_USER:
        return jsonify({"error": "The library lives on the server."}), 400
    path = db.data_dir()
    try:
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606 - a known local directory
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except OSError as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"ok": True, "folder": path})


@app.post("/api/open")
@auth.api_login_required
def api_open():
    """Open a card's Scryfall page in the real browser, not inside the window."""
    url = (request.get_json(silent=True) or {}).get("url", "")
    if not url.startswith("https://scryfall.com/"):
        return jsonify({"error": "Refusing to open a non-Scryfall URL"}), 400
    if not LOCAL_USER:
        return jsonify({"ok": True, "url": url, "open_here": True})
    webbrowser.open(url)
    return jsonify({"ok": True})


@app.get("/img")
@auth.api_login_required
def img():
    """Cached image proxy - keeps repeat views off Scryfall's CDN entirely."""
    url = request.args.get("u") or ""
    try:
        data = scryfall.image_bytes(url)
    except scryfall.ScryfallError as exc:
        return str(exc), 400
    mimetype = "image/png" if url.endswith(".png") else "image/jpeg"
    return Response(data, mimetype=mimetype, headers={"Cache-Control": "max-age=86400"})


if __name__ == "__main__":  # handy for styling work in a normal browser
    app.run(host="127.0.0.1", port=5000, debug=True)

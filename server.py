"""Flask backend for the card viewer.

Serves the single-page UI and proxies the handful of Scryfall calls it needs,
so the page never talks to the API directly and every image goes through the
on-disk cache.
"""

from __future__ import annotations

import os
import sys
import webbrowser

from flask import Flask, Response, jsonify, render_template, request

import scryfall

# PyInstaller unpacks the bundle to a temp dir; templates and static live there.
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)


@app.after_request
def _no_store(response):
    """The window is reloaded constantly during development; never cache the shell."""
    if response.mimetype in ("text/html", "text/css", "application/javascript"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/")
def index():
    return render_template("index.html")


def _card_response(fetch):
    try:
        return jsonify(fetch())
    except scryfall.ScryfallError as exc:
        return jsonify({"error": str(exc), "suggestions": exc.suggestions}), 404


@app.get("/api/card")
def api_card():
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Type a card name first."}), 400
    return _card_response(lambda: scryfall.card_by_name(name))


@app.get("/api/random")
def api_random():
    return _card_response(scryfall.random_card)


@app.get("/api/autocomplete")
def api_autocomplete():
    query = (request.args.get("q") or "").strip()
    if len(query) < 2:
        return jsonify([])
    return jsonify(scryfall.autocomplete(query)[:9])


@app.get("/api/printings")
def api_printings():
    uri = request.args.get("uri") or ""
    try:
        return jsonify(scryfall.printings_by_uri(uri))
    except scryfall.ScryfallError as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/open")
def api_open():
    """Open a card's Scryfall page in the real browser, not inside the window."""
    url = (request.get_json(silent=True) or {}).get("url", "")
    if not url.startswith("https://scryfall.com/"):
        return jsonify({"error": "Refusing to open a non-Scryfall URL"}), 400
    webbrowser.open(url)
    return jsonify({"ok": True})


@app.get("/img")
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

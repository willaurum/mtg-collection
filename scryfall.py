"""Minimal Scryfall API client.

Scryfall is free and needs no key, but it asks callers to send a descriptive
User-Agent and to leave 50-100ms between requests.  See
https://scryfall.com/docs/api
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.scryfall.com"
API_PREFIX = "https://api.scryfall.com/"
IMAGE_PREFIX = "https://cards.scryfall.io/"
USER_AGENT = "MTGCardViewer/1.0 (desktop card viewer)"
MIN_INTERVAL = 0.1  # seconds between requests, per Scryfall's rate-limit guidance
TIMEOUT = 20


def _cache_root():
    """Beside the source when running from a checkout; per-user once frozen."""
    if getattr(sys, "frozen", False):
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or tempfile.gettempdir()
        return os.path.join(base, "MTGCardViewer", "images")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "images")


CACHE_DIR = _cache_root()


class ScryfallError(Exception):
    """An error returned by Scryfall, or a transport failure."""

    def __init__(self, message, status=None, suggestions=None):
        super().__init__(message)
        self.status = status
        self.suggestions = suggestions or []


_throttle_lock = threading.Lock()
_last_request = 0.0


def _throttle():
    """Space requests out so we stay well inside Scryfall's rate limit."""
    global _last_request
    with _throttle_lock:
        wait = MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def _open(url, accept):
    _throttle()
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": accept}
    )
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def _get_json(url):
    try:
        with _open(url, "application/json") as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = "HTTP %s" % exc.code
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            detail = payload.get("details") or detail
        except Exception:
            pass
        raise ScryfallError(detail, status=exc.code) from exc
    except urllib.error.URLError as exc:
        raise ScryfallError("Network error: %s" % exc.reason) from exc


def card_by_name(name):
    """Look a card up by (fuzzy) name.

    On a miss, attach autocomplete suggestions to the raised error so the UI
    can offer something better than "not found".
    """
    query = urllib.parse.urlencode({"fuzzy": name})
    try:
        return _get_json("%s/cards/named?%s" % (API, query))
    except ScryfallError as exc:
        if exc.status in (404, 400):
            # Autocomplete is prefix-based, so a mangled tail kills it; retry
            # with just the first word before giving up on suggestions.
            exc.suggestions = autocomplete(name) or autocomplete(name.split()[0] if name.split() else "")
        raise


def card_by_uri(uri):
    return _get_json(uri)


def random_card():
    return _get_json("%s/cards/random" % API)


def autocomplete(partial):
    """Up to 20 card names starting with `partial`; never raises."""
    if not partial.strip():
        return []
    query = urllib.parse.urlencode({"q": partial})
    try:
        return _get_json("%s/cards/autocomplete?%s" % (API, query)).get("data", [])
    except ScryfallError:
        return []


def printings_by_uri(uri):
    """Every printing behind a `prints_search_uri`, oldest first.

    The URI reaches us from the browser layer, so pin it to Scryfall rather
    than fetching whatever we are handed.
    """
    if not uri.startswith(API_PREFIX):
        raise ScryfallError("Refusing to fetch a URL outside the Scryfall API")
    data = _get_json(uri).get("data", [])
    return sorted(data, key=lambda c: c.get("released_at") or "")


def printings(card):
    """Every printing of a card, oldest first.  One page (<=175) is plenty."""
    uri = card.get("prints_search_uri")
    if not uri:
        return [card]
    try:
        return printings_by_uri(uri)
    except ScryfallError:
        return [card]


def image_bytes(url):
    """Fetch a card image, caching it on disk so re-viewing a card is instant."""
    if not url.startswith(IMAGE_PREFIX):
        raise ScryfallError("Refusing to fetch an image outside Scryfall's CDN")
    os.makedirs(CACHE_DIR, exist_ok=True)
    suffix = ".png" if ".png" in url else ".jpg"
    path = os.path.join(CACHE_DIR, hashlib.sha1(url.encode()).hexdigest() + suffix)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read()
    try:
        with _open(url, "image/*") as resp:
            data = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        raise ScryfallError("Could not download card image: %s" % exc) from exc
    tmp = path + ".part"
    with open(tmp, "wb") as fh:
        fh.write(data)
    os.replace(tmp, path)
    return data

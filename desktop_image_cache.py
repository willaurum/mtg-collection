"""One local card-art cache for every account used in this desktop install."""

from __future__ import annotations

import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

def image_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".cache")
    return os.path.join(base, "MTGCardViewer", "images")


class ImageHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        import scryfall
        request = urlsplit(self.path)
        if request.path != "/img":
            self.send_error(404)
            return
        url = parse_qs(request.query).get("u", [""])[0]
        try:
            data = scryfall.image_bytes(url)
        except scryfall.ScryfallError as exc:
            self.send_error(400, str(exc))
            return
        except OSError:
            self.send_error(503, "Could not save card image")
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/png" if ".png" in url else "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        # The image files are the cache; avoid a second copy in the webview.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass


def start():
    """Bind only to this device; the first image fetch goes directly to Scryfall."""
    import scryfall
    os.makedirs(scryfall.CACHE_DIR, exist_ok=True)
    with tempfile.TemporaryFile(dir=scryfall.CACHE_DIR):
        pass  # Check that every desktop account can write to the shared folder.
    server = ThreadingHTTPServer(("127.0.0.1", 0), ImageHandler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server

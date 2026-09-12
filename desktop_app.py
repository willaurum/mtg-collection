"""Desktop shell: serves the Flask app on a free local port and shows it in a
native window via pywebview.

Run with:  python desktop_app.py
"""

from __future__ import annotations

import socket
import sys
import threading
import time

import webview

from server import app

TITLE = "MTG Card Viewer"
BACKGROUND = "#0a1310"


def free_port():
    """Let the OS pick an unused port so two copies can run side by side."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def serve(port):
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False, use_reloader=False)


def wait_until_up(port, timeout=10.0):
    """Don't point the window at the server until it is actually accepting."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def main():
    port = free_port()
    threading.Thread(target=serve, args=(port,), daemon=True).start()
    if not wait_until_up(port):
        print("The local server did not start in time.", file=sys.stderr)
        return 1

    webview.create_window(
        TITLE,
        f"http://127.0.0.1:{port}",
        width=1180,
        height=800,
        min_size=(900, 640),
        background_color=BACKGROUND,
    )
    webview.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())

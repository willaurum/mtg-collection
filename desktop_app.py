"""Desktop shell.

Two modes:

  python desktop_app.py
      Runs the Flask app against a local SQLite library and opens it in a
      native window.  No login — there is nobody else on the machine.

  python desktop_app.py --server http://raspberrypi.local:8000
      Points the same window at a shared server instead.  You sign in, and the
      collection and decks are the ones on that machine.  If it cannot be
      reached, the window falls back to the local library rather than showing
      an error page — with a note saying so.

The URL is remembered, so `--server` only needs passing once; `--local` forgets
it again.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import webview

TITLE = "MTG Card Viewer"
BACKGROUND = "#0b100d"
LOCAL_ACCOUNT = "local"


def config_path():
    import db
    return os.path.join(db.data_dir(), "desktop.json")


def load_config():
    try:
        with open(config_path(), encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def save_config(config):
    try:
        with open(config_path(), "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2)
    except OSError:
        pass


def free_port():
    """Let the OS pick an unused port so two copies can run side by side."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_until_up(port, timeout=15.0):
    """Don't point the window at the server until it is actually accepting."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def server_reachable(url, timeout=4.0):
    """A quick probe so a sleeping Pi costs seconds, not a broken window."""
    probe = url.rstrip("/") + "/api/me"
    try:
        request = urllib.request.Request(probe, headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status < 500
    except (urllib.error.HTTPError,) as exc:
        return exc.code < 500          # 401 means it is up and asking us to sign in
    except (urllib.error.URLError, OSError, ValueError):
        return False


def start_local():
    """Run the bundled Flask app with a single auto-signed-in local account."""
    import auth
    import db

    db.migrate()
    os.environ["MTG_LOCAL_USER"] = LOCAL_ACCOUNT
    if not auth.find_user(LOCAL_ACCOUNT):
        # A placeholder password: this account is only reachable from the
        # desktop process, which signs itself in.
        auth.create_user(LOCAL_ACCOUNT, os.urandom(16).hex())

    from server import app
    port = free_port()
    threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=port, threaded=True,
                               debug=False, use_reloader=False),
        daemon=True,
    ).start()
    if not wait_until_up(port):
        return None
    return "http://127.0.0.1:%d" % port


def main():
    parser = argparse.ArgumentParser(description="MTG Card Viewer desktop window")
    parser.add_argument("--server", metavar="URL",
                        help="use a shared server, e.g. http://raspberrypi.local:8000")
    parser.add_argument("--local", action="store_true",
                        help="forget the saved server and use the local library")
    args = parser.parse_args()

    config = load_config()
    if args.local:
        config.pop("server", None)
        save_config(config)
    elif args.server:
        config["server"] = args.server.rstrip("/")
        save_config(config)

    target = config.get("server")
    title = TITLE
    if target:
        print("Checking %s ..." % target)
        if server_reachable(target):
            title = "%s — %s" % (TITLE, target.split("//", 1)[-1])
        else:
            print("Could not reach %s; using the local library instead." % target,
                  file=sys.stderr)
            title = "%s — offline (local library)" % TITLE
            target = None

    if not target:
        target = start_local()
        if not target:
            print("The local server did not start in time.", file=sys.stderr)
            return 1

    webview.create_window(
        title, target,
        width=1180, height=800, min_size=(900, 640),
        background_color=BACKGROUND,
    )
    webview.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())

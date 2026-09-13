"""SQLite storage for the shared server.

One file, WAL mode, no daemon to administer - which is what you want on a Pi
that also has to survive being unplugged.

Every table that holds a person's data carries a `user_id`, so the schema is
multi-user from the first migration even while there is only one account on it.
Card data is the exception: `cards` is a shared cache of Scryfall payloads, so
the second person to add Lightning Bolt costs no API call at all.
"""

from __future__ import annotations

import ctypes
import os
import sqlite3
import sys
import threading

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created       TEXT    NOT NULL
);

-- Shared cache of Scryfall card payloads, keyed by Scryfall id.
CREATE TABLE cards (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  set_code         TEXT,
  collector_number TEXT,
  rarity           TEXT,
  data             TEXT NOT NULL,   -- the full Scryfall JSON
  fetched          TEXT NOT NULL
);
CREATE INDEX cards_name ON cards (name COLLATE NOCASE);

CREATE TABLE collection (
  user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id  TEXT    NOT NULL REFERENCES cards (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  added    TEXT    NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE decks (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  commander_id TEXT,
  created      TEXT    NOT NULL,
  updated      TEXT    NOT NULL
);
CREATE INDEX decks_user ON decks (user_id, name COLLATE NOCASE);

CREATE TABLE deck_cards (
  deck_id  TEXT    NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  card_id  TEXT    NOT NULL REFERENCES cards (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (deck_id, card_id)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


FOLDER_NAME = "MTG Card Viewer"
FOLDERID_DOCUMENTS = "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}"


class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort),
                ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]


def _windows_documents():
    """Ask Windows where Documents actually is - it may be redirected to OneDrive."""
    try:
        guid = _GUID()
        if ctypes.windll.ole32.CLSIDFromString(FOLDERID_DOCUMENTS, ctypes.byref(guid)) != 0:
            return None
        buffer = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(
                ctypes.byref(guid), 0, None, ctypes.byref(buffer)) != 0:
            return None
        path = buffer.value
        ctypes.windll.ole32.CoTaskMemFree(buffer)
        return path
    except Exception:  # noqa: BLE001 - any failure just means "use the fallback"
        return None


def documents_dir():
    if sys.platform == "win32":
        found = _windows_documents()
        if found and os.path.isdir(found):
            return found
    return os.path.join(os.path.expanduser("~"), "Documents")


def data_dir():
    """Where the database, secret key and image cache live.

    Set MTG_DATA_DIR on the server.  Otherwise this is the same Documents
    folder the desktop app has always used, so an existing install keeps its
    cached art and its old JSON folder sits right beside the new database.
    """
    override = os.environ.get("MTG_DATA_DIR")
    path = override or os.path.join(documents_dir(), FOLDER_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def db_path():
    return os.path.join(data_dir(), "library.db")


_local = threading.local()


def connect():
    """One connection per thread; gunicorn and Flask both hand out threads."""
    existing = getattr(_local, "conn", None)
    if existing is not None:
        return existing

    first_run = not os.path.exists(db_path())
    conn = sqlite3.connect(db_path(), timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")      # readers never block the writer
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA synchronous = NORMAL")
    _local.conn = conn
    if first_run:
        migrate(conn)
    return conn


def close():
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


def version(conn):
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    except sqlite3.OperationalError:
        return 0
    return int(row["value"]) if row else 0


def migrate(conn=None):
    """Create or upgrade the schema.  Safe to call on every start.

    No explicit transaction here: executescript() commits on its own, which
    would close one out from under us.  Each step is its own statement instead.
    """
    conn = conn or connect()
    current = version(conn)
    if current >= SCHEMA_VERSION:
        return current
    if current == 0:
        conn.executescript(SCHEMA)
        current = 1
    if current < 2:
        # A card can be a normal owned copy or a proxy, and can live in the
        # main deck or the maybeboard. Defaults retain every existing deck.
        conn.execute(
            "ALTER TABLE deck_cards ADD COLUMN zone TEXT NOT NULL DEFAULT 'main' "
            "CHECK (zone IN ('main', 'maybeboard'))"
        )
        conn.execute(
            "ALTER TABLE deck_cards ADD COLUMN proxy INTEGER NOT NULL DEFAULT 0 "
            "CHECK (proxy IN (0, 1))"
        )
    # Later versions add their steps here, guarded by `current < N`.
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (str(SCHEMA_VERSION),),
    )
    return SCHEMA_VERSION


class transaction:
    """`with transaction():` — commits on success, rolls back on an exception.

    isolation_level is None so sqlite3 does not start transactions behind our
    back; that keeps the boundaries exactly where they are written.
    """

    def __init__(self, conn=None):
        self.conn = conn or connect()

    def __enter__(self):
        self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, _exc, _tb):
        if exc_type is None:
            self.conn.execute("COMMIT")
        else:
            self.conn.execute("ROLLBACK")
        return False

"""Accounts, passwords and sessions.

Passwords go through Werkzeug's scrypt, which ships with Flask — no compiled
extension to fight with on a Raspberry Pi. Sessions are Flask's signed cookies,
keyed by a secret generated once and kept in the data directory, so restarting
the service does not log everyone out.

The cookie flags and the login throttle are written for an internet-facing
server even while this one only listens on the LAN; opening it up later should
be a config change, not a rewrite.
"""

from __future__ import annotations

import datetime
import functools
import os
import secrets
import sqlite3
import threading
import time

from flask import g, jsonify, redirect, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

import db

SESSION_KEY = "uid"
MIN_PASSWORD = 8

# Login throttle: per username+address, in memory. Enough to make guessing
# pointless; a restart clears it, which is fine for a home server.
MAX_ATTEMPTS = 8
LOCKOUT_SECONDS = 300
_attempts = {}
_attempts_lock = threading.Lock()


def secret_key():
    """A stable signing key, created once with 0600 permissions."""
    path = os.path.join(db.data_dir(), "secret.key")
    if os.path.exists(path):
        with open(path, "rb") as handle:
            key = handle.read().strip()
            if len(key) >= 32:
                return key
    key = secrets.token_bytes(48)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(key)
    return key


def configure(app):
    """Session cookie policy.  MTG_HTTPS=1 once it is served over TLS."""
    https = os.environ.get("MTG_HTTPS", "").lower() in ("1", "true", "yes")
    app.secret_key = secret_key()
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,     # JavaScript cannot read it
        SESSION_COOKIE_SAMESITE="Lax",    # not sent on cross-site POSTs
        SESSION_COOKIE_SECURE=https,      # HTTPS only, once there is HTTPS
        PERMANENT_SESSION_LIFETIME=datetime.timedelta(days=30),
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,
    )
    return app


# ----------------------------------------------------------------- users

def create_user(username, password, is_admin=False):
    username = (username or "").strip()
    if not username:
        raise ValueError("Username cannot be empty.")
    if len(password or "") < MIN_PASSWORD:
        raise ValueError("Password must be at least %d characters." % MIN_PASSWORD)
    try:
        with db.transaction() as conn:
            cursor = conn.execute(
                """INSERT INTO users (username, password_hash, is_admin, created)
                   VALUES (?, ?, ?, ?)""",
                (username, generate_password_hash(password), 1 if is_admin else 0,
                 datetime.datetime.now().isoformat(timespec="seconds")))
            return cursor.lastrowid
    except sqlite3.IntegrityError as exc:
        raise ValueError("That username is already taken.") from exc


def set_password(username, password):
    if len(password or "") < MIN_PASSWORD:
        raise ValueError("Password must be at least %d characters." % MIN_PASSWORD)
    with db.transaction() as conn:
        changed = conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (generate_password_hash(password), username)).rowcount
    if not changed:
        raise ValueError("No such user: %s" % username)


def find_user(username):
    return db.connect().execute(
        "SELECT * FROM users WHERE username = ?", (username or "",)).fetchone()


def user_by_id(user_id):
    return db.connect().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def list_users():
    return db.connect().execute(
        "SELECT id, username, is_admin, created FROM users ORDER BY username"
    ).fetchall()


def delete_user(username):
    with db.transaction() as conn:
        changed = conn.execute("DELETE FROM users WHERE username = ?",
                               (username,)).rowcount
    return bool(changed)


def any_users():
    return bool(db.connect().execute("SELECT 1 FROM users LIMIT 1").fetchone())


# ------------------------------------------------------------- throttle

def _throttle_key(username):
    return ((username or "").lower(), request.remote_addr or "?")


def locked_out(username):
    with _attempts_lock:
        record = _attempts.get(_throttle_key(username))
        if not record:
            return 0
        count, first = record
        if count < MAX_ATTEMPTS:
            return 0
        remaining = LOCKOUT_SECONDS - (time.monotonic() - first)
        if remaining <= 0:
            _attempts.pop(_throttle_key(username), None)
            return 0
        return int(remaining)


def note_failure(username):
    with _attempts_lock:
        key = _throttle_key(username)
        count, first = _attempts.get(key, (0, time.monotonic()))
        if time.monotonic() - first > LOCKOUT_SECONDS:
            count, first = 0, time.monotonic()
        _attempts[key] = (count + 1, first)


def clear_failures(username):
    with _attempts_lock:
        _attempts.pop(_throttle_key(username), None)


# -------------------------------------------------------------- session

def authenticate(username, password):
    """Return the user row, or None.  Always costs a hash to compare."""
    user = find_user(username)
    stored = user["password_hash"] if user else (
        # Compare against a dummy so a missing user takes the same time as a
        # wrong password and cannot be told apart by timing.
        "scrypt:32768:8:1$dummy$" + "0" * 128)
    ok = check_password_hash(stored, password or "")
    return user if (ok and user) else None


def log_in(user):
    session.clear()
    session[SESSION_KEY] = user["id"]
    session.permanent = True


def log_out():
    session.clear()


def current_user():
    """The logged-in user row for this request, or None."""
    if "user" not in g:
        user_id = session.get(SESSION_KEY)
        g.user = user_by_id(user_id) if user_id else None
        if user_id and g.user is None:
            session.clear()          # the account was deleted underneath us
    return g.user


def login_required(view):
    """Guard a page: bounce to the login form, remembering where they wanted."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def api_login_required(view):
    """Guard an API route: 401 with JSON, never an HTML redirect."""
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return jsonify({"error": "Please sign in again.", "auth": False}), 401
        return view(*args, **kwargs)
    return wrapped


def user_id():
    user = current_user()
    return user["id"] if user else None

"""Migration recovery must preserve existing library and wishlist data."""

import sqlite3
import unittest

import db


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:", isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        db.migrate(self.conn)
        self.conn.execute("INSERT INTO users VALUES (1, 'owner', 'hash', 0, 'today')")
        self.conn.execute(
            "INSERT INTO cards VALUES ('card', 'Card', 'tst', '1', 'common', '{}', 'today')")
        self.conn.execute("INSERT INTO collection VALUES (1, 'card', 4, 'today')")
        self.conn.execute(
            "INSERT INTO decks (id, user_id, name, created, updated) "
            "VALUES ('deck', 1, 'Deck', 'today', 'today')")
        self.conn.execute("INSERT INTO deck_cards VALUES ('deck', 'card', 2, 'main', 0)")

    def tearDown(self):
        self.conn.close()

    def assert_library_preserved(self):
        self.assertEqual(self.conn.execute("SELECT quantity FROM collection").fetchone()[0], 4)
        self.assertEqual(self.conn.execute("SELECT quantity FROM deck_cards").fetchone()[0], 2)
        self.assertEqual(self.conn.execute("PRAGMA integrity_check").fetchone()[0], 'ok')
        self.assertEqual(db.version(self.conn), 8)

    def test_missing_wishlist_repaired_from_versions_five_and_six(self):
        for version in (5, 6):
            with self.subTest(version=version):
                self.conn.execute("DROP TABLE wishlist")
                self.conn.execute("UPDATE meta SET value = ? WHERE key = 'schema_version'", (str(version),))
                db.migrate(self.conn)
                self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM wishlist").fetchone()[0], 0)
                self.assert_library_preserved()

    def test_existing_wishes_survive_upgrade_and_repeated_migration(self):
        self.conn.execute("INSERT INTO wishlist VALUES (1, 'card', 3, 'today')")
        for version in (5, 6, 7, 8):
            with self.subTest(version=version):
                self.conn.execute("UPDATE meta SET value = ? WHERE key = 'schema_version'", (str(version),))
                db.migrate(self.conn)
                self.assertEqual(self.conn.execute("SELECT quantity FROM wishlist").fetchone()[0], 3)
                self.assert_library_preserved()

    def test_deck_roles_are_added_without_changing_existing_decks(self):
        self.conn.execute("UPDATE meta SET value = '7' WHERE key = 'schema_version'")
        self.conn.execute("ALTER TABLE decks DROP COLUMN partner_id")
        self.conn.execute("ALTER TABLE decks DROP COLUMN companion_id")
        db.migrate(self.conn)
        row = self.conn.execute(
            "SELECT commander_id, partner_id, companion_id FROM decks WHERE id = 'deck'"
        ).fetchone()
        self.assertEqual(tuple(row), (None, None, None))
        self.assert_library_preserved()


if __name__ == '__main__':
    unittest.main()

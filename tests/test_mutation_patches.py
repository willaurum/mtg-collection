"""Regression checks for compact library responses after writes."""

from __future__ import annotations

import os
import unittest


TEST_DATA = os.path.dirname(__file__)
os.environ["MTG_DATA_DIR"] = TEST_DATA

import auth  # noqa: E402  (the data directory must be set before importing)
import db  # noqa: E402
import store  # noqa: E402
auth.secret_key = lambda: b"test-session-key" * 4  # noqa: E731
from server import app  # noqa: E402


def card(card_id, name, price="1.00"):
    return {
        "id": card_id,
        "name": name,
        "set": "tst",
        "set_name": "Test Set",
        "collector_number": "1",
        "rarity": "common",
        "prices": {"usd": price},
    }


class MutationPatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.config.update(TESTING=True)
        db.migrate()

    @classmethod
    def tearDownClass(cls):
        db.close()
        for name in ("library.db", "library.db-shm", "library.db-wal"):
            try:
                os.remove(os.path.join(TEST_DATA, name))
            except FileNotFoundError:
                pass

    def setUp(self):
        with db.transaction() as conn:
            conn.execute("DELETE FROM users")
            conn.execute("DELETE FROM cards")
        self.user_id = auth.create_user("test-user", "a long test password")
        self.client = app.test_client()
        with self.client.session_transaction() as session:
            session[auth.SESSION_KEY] = self.user_id

    def post(self, url, payload):
        response = self.client.post(url, json=payload)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def test_card_mutation_only_returns_that_card(self):
        first = self.post("/api/collection/add", {"card": card("bolt", "Lightning Bolt")})
        self.assertEqual([entry["id"] for entry in first["entries"]], ["bolt"])
        self.assertEqual(first["summary"]["total"], 1)

        self.post("/api/collection/add", {"card": card("bird", "Birds of Paradise")})
        changed = self.post("/api/collection/add", {"card": card("bolt", "Lightning Bolt")})

        self.assertEqual([entry["id"] for entry in changed["entries"]], ["bolt"])
        self.assertEqual(changed["entry"]["quantity"], 2)
        self.assertEqual(changed["summary"]["distinct"], 2)
        self.assertNotIn("library", changed)

    def test_deck_patch_updates_only_the_affected_deck_and_card(self):
        self.post("/api/collection/add", {"card": card("bolt", "Lightning Bolt")})
        created = self.post("/api/decks/create", {"name": "Burn"})
        deck_id = created["deck_id"]

        added = self.post("/api/decks/add", {"deck_id": deck_id, "card_id": "bolt"})
        self.assertEqual([entry["id"] for entry in added["entries"]], ["bolt"])
        self.assertEqual([deck["id"] for deck in added["decks"]], [deck_id])
        self.assertEqual(added["entries"][0]["available"], 0)

        renamed = self.post("/api/decks/rename", {"id": deck_id, "name": "Mono Red"})
        self.assertEqual(renamed["decks"][0]["name"], "Mono Red")
        self.assertEqual(renamed["entries"][0]["locations"][0]["deck_name"], "Mono Red")

        deleted = self.post("/api/decks/delete", {"id": deck_id})
        self.assertEqual(deleted["removed_decks"], [deck_id])
        self.assertEqual(deleted["entries"][0]["available"], 1)

    def test_profile_export_import_preserves_cards_and_decks(self):
        store.add_card(self.user_id, card("bolt", "Lightning Bolt"), quantity=2)
        deck_id = store.create_deck(self.user_id, "Burn")
        store.deck_add(self.user_id, deck_id, "bolt")
        store.set_commander(self.user_id, deck_id, "bolt")

        profile = store.export_profile(self.user_id)
        other_user = auth.create_user("backup-user", "a long test password")
        report = store.import_profile(other_user, profile)
        copied = store.library(other_user)

        self.assertEqual(profile["format"], store.PROFILE_FORMAT)
        self.assertEqual(report["cards"], 2)
        self.assertEqual(report["decks"], 1)
        self.assertEqual(copied["entries"][0]["quantity"], 2)
        self.assertEqual(copied["decks"][0]["name"], "Burn")
        self.assertEqual(copied["decks"][0]["cards"][0]["quantity"], 1)
        self.assertEqual(copied["decks"][0]["commander_id"], "bolt")

        store.add_card(other_user, card("bird", "Birds of Paradise"))
        restored = store.import_profile(other_user, profile, mode="replace")
        restored_library = store.library(other_user)
        self.assertEqual(restored["cards"], 2)
        self.assertEqual([entry["id"] for entry in restored_library["entries"]], ["bolt"])
        self.assertEqual(restored_library["entries"][0]["quantity"], 2)
        self.assertEqual(len(restored_library["decks"]), 1)


if __name__ == "__main__":
    unittest.main()

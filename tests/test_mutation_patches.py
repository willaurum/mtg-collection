"""Regression checks for compact library responses after writes."""

from __future__ import annotations

import os
import unittest
from decimal import Decimal
from unittest.mock import patch


TEST_DATA = os.path.dirname(__file__)
os.environ["MTG_DATA_DIR"] = TEST_DATA

import auth  # noqa: E402  (the data directory must be set before importing)
import db  # noqa: E402
import store  # noqa: E402
import scryfall  # noqa: E402
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

        categorized = self.post("/api/decks/category", {"id": deck_id, "category": "Competitive"})
        self.assertEqual(categorized["decks"][0]["category"], "Competitive")

        deleted = self.post("/api/decks/delete", {"id": deck_id})
        self.assertEqual(deleted["removed_decks"], [deck_id])
        self.assertEqual(deleted["entries"][0]["available"], 1)

    def test_printing_change_moves_only_deck_copies_and_preserves_commander(self):
        store.add_card(self.user_id, card("old", "Bolt"), 4)
        store.add_card(self.user_id, card("new", "Bolt"), 1)
        deck = store.create_deck(self.user_id, "Burn")
        other = store.create_deck(self.user_id, "Other")
        store.deck_add(self.user_id, deck, "old", 2)
        store.deck_add(self.user_id, deck, "new")
        store.deck_add(self.user_id, other, "old")
        store.set_commander(self.user_id, deck, "old")
        result = self.post("/api/decks/printing", {
            "deck_id": deck, "card_id": "old", "card": card("new", "Bolt", "2.00")})
        entries = {item["id"]: item for item in result["entries"]}
        self.assertEqual(entries["old"]["quantity"], 2)
        self.assertEqual(entries["old"]["available"], 1)
        self.assertEqual(entries["new"]["quantity"], 3)
        self.assertEqual(entries["new"]["available"], 0)
        self.assertEqual(result["decks"][0]["commander_id"], "new")
        self.assertEqual(len(result["decks"][0]["cards"]), 1)
        self.assertEqual(result["decks"][0]["cards"][0]["quantity"], 3)
        self.assertEqual(store.deck_state(self.user_id, other)["cards"][0]["card_id"], "old")

    def test_printing_change_removes_empty_collection_row(self):
        store.add_card(self.user_id, card("old", "Bolt"))
        deck = store.create_deck(self.user_id)
        store.deck_add(self.user_id, deck, "old")
        result = self.post("/api/decks/printing", {
            "deck_id": deck, "card_id": "old", "card": card("new", "Bolt")})
        self.assertIn("old", result["removed_entries"])
        self.assertEqual(result["summary"]["total"], 1)

    def test_proxy_printing_change_does_not_change_collection(self):
        store.add_card(self.user_id, card("old", "Bolt"), 2)
        deck = store.create_deck(self.user_id)
        store.deck_add(self.user_id, deck, "old")
        store.set_proxy(self.user_id, deck, "old", True)
        self.post("/api/decks/printing", {
            "deck_id": deck, "card_id": "old", "card": card("new", "Bolt")})
        self.assertEqual(store.entry(self.user_id, "old")["quantity"], 2)
        self.assertIsNone(store.entry(self.user_id, "new"))
        self.assertTrue(store.deck_state(self.user_id, deck)["cards"][0]["proxy"])

    def test_printing_change_rejects_conflicts_other_cards_and_other_users(self):
        store.add_card(self.user_id, card("old", "Bolt"))
        deck = store.create_deck(self.user_id)
        store.deck_add(self.user_id, deck, "old")
        store.deck_add(self.user_id, deck, card=card("new", "Bolt"), zone="maybeboard")
        before = store.export_profile(self.user_id)
        for replacement in (card("new", "Bolt"), card("bird", "Bird"), None):
            response = self.client.post("/api/decks/printing", json={
                "deck_id": deck, "card_id": "old", "card": replacement})
            self.assertEqual(response.status_code, 409)
        self.assertEqual(store.export_profile(self.user_id), before)
        other_user = auth.create_user("other-user", "a long test password")
        with self.assertRaises(store.StoreError):
            store.change_deck_printing(other_user, deck, "old", card("third", "Bolt"))

    def test_maybeboard_printing_change_respects_allocated_copies(self):
        store.add_card(self.user_id, card("old", "Bolt"))
        deck = store.create_deck(self.user_id)
        other = store.create_deck(self.user_id)
        store.deck_add(self.user_id, deck, "old", zone="maybeboard")
        store.deck_add(self.user_id, other, "old")
        with self.assertRaises(store.StoreError):
            store.change_deck_printing(self.user_id, deck, "old", card("new", "Bolt"))
        store.add_card(self.user_id, card("old", "Bolt"))
        store.change_deck_printing(self.user_id, deck, "old", card("new", "Bolt"))
        self.assertEqual(store.deck_state(self.user_id, deck)["cards"][0]["zone"], "maybeboard")
        self.assertEqual(store.entry(self.user_id, "old")["quantity"], 1)

    def test_profile_export_import_preserves_cards_and_decks(self):
        store.add_card(self.user_id, card("bolt", "Lightning Bolt"), quantity=2)
        deck_id = store.create_deck(self.user_id, "Burn")
        store.set_deck_category(self.user_id, deck_id, "Modern")
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
        self.assertEqual(copied["decks"][0]["category"], "Modern")
        self.assertEqual(copied["decks"][0]["cards"][0]["quantity"], 1)
        self.assertEqual(copied["decks"][0]["commander_id"], "bolt")

        store.add_card(other_user, card("bird", "Birds of Paradise"))
        restored = store.import_profile(other_user, profile, mode="replace")
        restored_library = store.library(other_user)
        self.assertEqual(restored["cards"], 2)
        self.assertEqual([entry["id"] for entry in restored_library["entries"]], ["bolt"])
        self.assertEqual(restored_library["entries"][0]["quantity"], 2)
        self.assertEqual(len(restored_library["decks"]), 1)

    def test_price_history_records_current_collection_value(self):
        store.add_card(self.user_id, card("bolt", "Lightning Bolt", "3.50"), quantity=2)
        history = store.price_history(self.user_id)
        self.assertEqual(history["current"], 7.0)
        self.assertEqual(history["history"][0]["value"], 7.0)

    def test_deck_value_counts_main_deck_cards_and_price_refresh_includes_proxies(self):
        store.add_card(self.user_id, card("bolt", "Lightning Bolt", "2.50"))
        deck_id = store.create_deck(self.user_id, "Priced deck")
        store.deck_add(self.user_id, deck_id, "bolt")
        store.deck_add(self.user_id, deck_id, card=card("proxy", "Proxy Card", "3.25"))

        deck = store.deck_state(self.user_id, deck_id)
        self.assertEqual(deck["value"], 5.75)
        self.assertEqual(deck["maybeboard_value"], 0)
        self.assertEqual(store.collection_card_ids(self.user_id), ["bolt", "proxy"])

    def test_proxy_and_maybeboard_do_not_consume_owned_copies(self):
        deck_id = self.post("/api/decks/create", {"name": "Test deck"})["deck_id"]

        proxy = self.post("/api/decks/add", {
            "deck_id": deck_id,
            "card": card("borrowed", "Borrowed Card"),
        })
        line = proxy["decks"][0]["cards"][0]
        self.assertTrue(proxy["proxy_added"])
        self.assertTrue(line["proxy"])
        self.assertEqual(line["zone"], "main")
        self.assertEqual(line["card"]["name"], "Borrowed Card")
        self.assertEqual(proxy["summary"]["allocated"], 0)

        incremented = self.post("/api/decks/add", {"deck_id": deck_id, "card_id": "borrowed"})
        self.assertEqual(incremented["decks"][0]["cards"][0]["quantity"], 2)

        # Acquiring a proxy later does not silently turn the existing proxy
        # line into an allocated owned copy.
        self.post("/api/collection/add", {"card": card("borrowed", "Borrowed Card")})
        still_proxy = self.post("/api/decks/add", {"deck_id": deck_id, "card_id": "borrowed"})
        borrowed_line = still_proxy["decks"][0]["cards"][0]
        self.assertTrue(borrowed_line["proxy"])
        self.assertEqual(still_proxy["summary"]["allocated"], 0)

        self.post("/api/collection/add", {"card": card("bolt", "Lightning Bolt")})
        added = self.post("/api/decks/add", {
            "deck_id": deck_id, "card_id": "bolt", "zone": "maybeboard",
        })
        bolt_line = next(line for line in added["decks"][0]["cards"] if line["card_id"] == "bolt")
        self.assertEqual(bolt_line["zone"], "maybeboard")
        self.assertFalse(bolt_line["proxy"])
        self.assertEqual(added["summary"]["allocated"], 0)
        self.assertEqual(added["decks"][0]["maybeboard_count"], 1)

        moved = self.post("/api/decks/move", {
            "deck_id": deck_id, "card_id": "bolt", "zone": "main",
        })
        self.assertEqual(moved["summary"]["allocated"], 1)
        self.assertEqual(moved["entries"][0]["available"], 0)

    def test_wishlist_merges_manual_wishes_and_main_deck_proxies(self):
        wanted = card("wanted", "Wanted Card")
        store.wishlist_add(self.user_id, wanted, 2)
        deck_id = store.create_deck(self.user_id, "Proxy deck")
        store.deck_add(self.user_id, deck_id, card=wanted, quantity=3)
        store.deck_add(self.user_id, deck_id, card=card("maybe", "Maybe"), zone="maybeboard")

        wishes = store.library(self.user_id)["wishlist"]
        self.assertEqual(len(wishes), 1)
        self.assertEqual(wishes[0]["manual_quantity"], 2)
        self.assertEqual(wishes[0]["proxy_quantity"], 3)
        self.assertEqual(wishes[0]["quantity"], 3)
        self.assertEqual(wishes[0]["proxy_decks"][0]["deck_name"], "Proxy deck")

        store.wishlist_remove(self.user_id, "wanted", drop_all=True)
        proxy_only = store.library(self.user_id)["wishlist"][0]
        self.assertEqual(proxy_only["manual_quantity"], 0)
        self.assertEqual(proxy_only["quantity"], 3)

    def test_wishlist_is_user_scoped_and_round_trips_in_profiles(self):
        store.wishlist_add(self.user_id, card("wish", "Wish"), 2)
        other_user = auth.create_user("wishlist-user", "a long test password")
        self.assertEqual(store.wishlist(other_user), [])

        profile = store.export_profile(self.user_id)
        store.import_profile(other_user, profile)
        copied = store.wishlist(other_user)
        self.assertEqual(copied[0]["id"], "wish")
        self.assertEqual(copied[0]["manual_quantity"], 2)

    def test_lookup_add_uses_proxy_when_no_owned_copy_is_free(self):
        self.post("/api/collection/add", {"card": card("bolt", "Lightning Bolt")})
        first_deck = self.post("/api/decks/create", {"name": "First deck"})["deck_id"]
        second_deck = self.post("/api/decks/create", {"name": "Second deck"})["deck_id"]

        owned = self.post("/api/decks/add", {"deck_id": first_deck, "card_id": "bolt"})
        self.assertFalse(owned["proxy_added"])
        self.assertEqual(owned["summary"]["allocated"], 1)
        self.assertEqual(owned["entries"][0]["available"], 0)

        lookup = self.post("/api/decks/add", {
            "deck_id": second_deck,
            "card": card("bolt", "Lightning Bolt"),
        })
        line = lookup["decks"][0]["cards"][0]
        self.assertTrue(lookup["proxy_added"])
        self.assertTrue(line["proxy"])
        self.assertEqual(line["quantity"], 1)
        self.assertEqual(lookup["summary"]["allocated"], 1)
        self.assertEqual(lookup["entries"][0]["available"], 0)

        converted = self.post("/api/decks/add", {
            "deck_id": first_deck,
            "card": card("bolt", "Lightning Bolt"),
        })
        converted_line = converted["decks"][0]["cards"][0]
        self.assertTrue(converted["proxy_added"])
        self.assertTrue(converted_line["proxy"])
        self.assertEqual(converted_line["quantity"], 2)
        self.assertEqual(converted["summary"]["allocated"], 0)
        self.assertEqual(converted["entries"][0]["available"], 1)

    def test_password_change_requires_current_password_and_validates_new_password(self):
        url = "/api/account/password"
        original = "a long test password"
        result = self.client.post(url, json={"current_password": "wrong", "new_password": "replacement password"})
        self.assertEqual(result.status_code, 400)
        self.assertIsNotNone(auth.authenticate("test-user", original))
        result = self.client.post(url, json={"current_password": original, "new_password": "short"})
        self.assertEqual(result.status_code, 400)
        self.post(url, {"current_password": original, "new_password": "replacement password"})
        self.assertIsNone(auth.authenticate("test-user", original))
        self.assertIsNotNone(auth.authenticate("test-user", "replacement password"))
        with patch("server.LOCAL_USER", "test-user"):
            self.assertEqual(self.client.post(url, json={}).status_code, 400)
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.post(url, json={}).status_code, 401)
        self.assertEqual(self.client.post("/api/cache/images/clear").status_code, 401)

    def test_cache_clear_endpoint_reports_count(self):
        with patch("scryfall.clear_image_cache", return_value=3):
            self.assertEqual(self.post("/api/cache/images/clear", {}), {"removed": 3})

    def test_force_refresh_bypasses_daily_limit_and_updates_all_price_types(self):
        store.add_card(self.user_id, card("owned", "Owned Card", "1.00"), quantity=3)
        deck_id = store.create_deck(self.user_id, "Prices")
        store.deck_add(self.user_id, deck_id, card=card("proxy", "Proxy Card", "2.00"))
        store.refresh_collection_prices(self.user_id, [])
        self.assertFalse(store.price_refresh_due(self.user_id))
        with patch("scryfall.cards_by_identifiers", return_value=(
                [card("owned", "Owned Card", "4.00"), card("proxy", "Proxy Card", "5.00")], [])) as batch, \
             patch("scryfall.clear_cheapest_price_cache") as clear, \
             patch("scryfall.cheapest_printing_usd", return_value=Decimal("0.25")) as cheapest:
            result = self.post("/api/prices/refresh", {})
        self.assertEqual(result["summary"]["value"], 12.0)
        self.assertEqual(result["decks"][0]["value"], 5.0)
        self.assertTrue(result["prices_refreshed"])
        self.assertFalse(result["prices_stale"])
        self.assertEqual(batch.call_args.args[0], [{"id": "owned"}, {"id": "proxy"}])
        clear.assert_called_once()
        cheapest.assert_called_once()
        self.assertEqual(store.price_history(self.user_id)["current"], 12.0)

    def test_force_refresh_reports_partial_and_failed_updates(self):
        store.add_card(self.user_id, card("owned", "Owned Card", "2.00"), quantity=2)
        with patch("scryfall.cards_by_identifiers", return_value=([], [{"id": "owned"}])):
            result = self.post("/api/prices/refresh", {})
        self.assertTrue(result["prices_stale"])
        self.assertEqual(result["summary"]["value"], 4.0)
        self.assertTrue(store.price_refresh_due(self.user_id))
        with patch("scryfall.cards_by_identifiers", side_effect=scryfall.ScryfallError("Offline")):
            result = self.post("/api/prices/refresh", {})
        self.assertTrue(result["prices_stale"])
        self.assertFalse(result["prices_refreshed"])
        self.assertEqual(result["summary"]["value"], 4.0)

    def test_force_refresh_reports_cheapest_lookup_failure_and_requires_login(self):
        deck_id = store.create_deck(self.user_id, "Prices")
        store.deck_add(self.user_id, deck_id, card=card("proxy", "Proxy Card"))
        with patch("scryfall.cards_by_identifiers", return_value=([card("proxy", "Proxy Card")], [])), \
             patch("scryfall.cheapest_printing_usd", side_effect=scryfall.ScryfallError("Offline")):
            self.assertTrue(self.post("/api/prices/refresh", {})["prices_stale"])
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.post("/api/prices/refresh").status_code, 401)

    def test_unowned_price_counts_shortfall_across_printings_and_excludes_maybeboard(self):
        store.add_card(self.user_id, card("owned-bolt", "Lightning Bolt"), quantity=2)
        deck_id = self.post("/api/decks/create", {"name": "Burn"})["deck_id"]
        for printing, quantity in (("bolt-a", 2), ("bolt-b", 3)):
            self.post("/api/decks/add", {"deck_id": deck_id,
                      "card": card(printing, "Lightning Bolt"), "quantity": quantity})
        self.post("/api/decks/add", {"deck_id": deck_id,
                  "card": card("maybe", "Maybeboard Card"), "zone": "maybeboard"})
        with patch("scryfall.cheapest_printing_usd", return_value=Decimal("0.17")) as lookup:
            response = self.client.get(f"/api/decks/{deck_id}/unowned-price")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(),
                         {"value": 0.51, "missing_count": 3, "unpriced_count": 0})
        lookup.assert_called_once()
        store.add_card(self.user_id, card("owned-bolt", "Lightning Bolt"), quantity=3)
        with patch("scryfall.cheapest_printing_usd") as lookup:
            result = self.client.get(f"/api/decks/{deck_id}/unowned-price").get_json()
        self.assertEqual(result, {"value": 0.0, "missing_count": 0, "unpriced_count": 0})
        lookup.assert_not_called()

    def test_unowned_price_flags_missing_prices_and_enforces_deck_ownership(self):
        deck_id = self.post("/api/decks/create", {"name": "Burn"})["deck_id"]
        for printing in ("a", "b", "c"):
            self.post("/api/decks/add", {"deck_id": deck_id,
                      "card": card(printing, printing), "quantity": 2})
        with patch("scryfall.cheapest_printing_usd",
                   side_effect=[Decimal("1.25"), None, scryfall.ScryfallError("Offline")]):
            result = self.client.get(f"/api/decks/{deck_id}/unowned-price").get_json()
        self.assertEqual(result, {"value": 2.5, "missing_count": 6, "unpriced_count": 4})
        other = auth.create_user("other-user", "another long password")
        with self.client.session_transaction() as session:
            session[auth.SESSION_KEY] = other
        with patch("scryfall.cheapest_printing_usd") as lookup:
            self.assertEqual(self.client.get(f"/api/decks/{deck_id}/unowned-price").status_code, 404)
        lookup.assert_not_called()

    def test_deck_import_can_reserve_owned_cards_or_add_missing_copies(self):
        store.add_card(self.user_id, card("bolt", "Lightning Bolt"), quantity=1)
        resolved = [
            {"card": card("bolt", "Lightning Bolt"), "entry": {"quantity": 1}},
            {"card": card("borrowed", "Borrowed Card"), "entry": {"quantity": 2}},
        ]

        imported = store.import_deck(self.user_id, "Imported", resolved, "prefer_collection")
        deck = store.deck_state(self.user_id, imported["deck_id"])
        lines = {line["card_id"]: line for line in deck["cards"]}
        self.assertFalse(lines["bolt"]["proxy"])
        self.assertTrue(lines["borrowed"]["proxy"])
        self.assertEqual(imported["owned"], 1)
        self.assertEqual(imported["proxies"], 2)

        added = store.import_deck(self.user_id, "Owned import", resolved, "add_missing")
        owned_deck = store.deck_state(self.user_id, added["deck_id"])
        self.assertTrue(all(not line["proxy"] for line in owned_deck["cards"]))
        self.assertEqual(added["added_to_collection"], 3)


if __name__ == "__main__":
    unittest.main()

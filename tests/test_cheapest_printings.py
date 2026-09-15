"""Pricing checks without external API calls."""

import unittest
from decimal import Decimal
from unittest.mock import patch

import scryfall


class CheapestPrintingTests(unittest.TestCase):
    def setUp(self):
        scryfall._cheapest_printing_usd.cache_clear()

    def tearDown(self):
        scryfall._cheapest_printing_usd.cache_clear()

    def test_checks_every_page_and_finish_and_caches_by_card_identity(self):
        pages = [
            {"data": [{"prices": {"usd": "3.00", "usd_foil": "1.50"}}],
             "has_more": True, "next_page": scryfall.API + "/cards/search?page=2"},
            {"data": [{"prices": {"usd": None, "usd_etched": "0.25"}},
                      {"prices": {"usd": "NaN", "usd_foil": "invalid"}}]},
        ]
        with patch("scryfall._get_json", side_effect=pages) as get:
            self.assertEqual(scryfall.cheapest_printing_usd({"oracle_id": "same-card"}), Decimal("0.25"))
            self.assertEqual(scryfall.cheapest_printing_usd({"oracle_id": "same-card", "id": "other-print"}), Decimal("0.25"))
            self.assertEqual(get.call_count, 2)
            self.assertIn("unique=prints", get.call_args_list[0].args[0])

    def test_unpriced_and_no_paper_printings_are_unknown(self):
        with patch("scryfall._get_json", return_value={"data": [{"prices": {"usd": None}}]}):
            self.assertIsNone(scryfall.cheapest_printing_usd({"name": "Unpriced"}))
        with patch("scryfall._get_json", side_effect=scryfall.ScryfallError("Not found", status=404)):
            self.assertIsNone(scryfall.cheapest_printing_usd({"name": "Digital only"}))

    def test_network_failure_is_not_cached_as_zero(self):
        with patch("scryfall._get_json", side_effect=[scryfall.ScryfallError("Offline"),
                   {"data": [{"prices": {"usd": "0.10"}}]}]) as get:
            with self.assertRaises(scryfall.ScryfallError):
                scryfall.cheapest_printing_usd({"name": "Retry"})
            self.assertEqual(scryfall.cheapest_printing_usd({"name": "Retry"}), Decimal("0.10"))
            self.assertEqual(get.call_count, 2)


if __name__ == "__main__":
    unittest.main()

"""Scryfall token search contract, without network access."""
import unittest
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs
import scryfall

class TokenSearchTests(unittest.TestCase):
    def setUp(self):
        scryfall.search_tokens.cache_clear()

    def test_token_filter_artwork_and_paging(self):
        card = {"name": "Soldier", "image_uris": {"normal": "art"}}
        with patch("scryfall._get_json", return_value={"data": [card], "has_more": True}) as fetch:
            result = scryfall.search_tokens("Soldier pow:1", 2)
            query = parse_qs(urlparse(fetch.call_args.args[0]).query)
            self.assertEqual(query["q"], ["t:token (Soldier pow:1)"])
            self.assertEqual(query["unique"], ["art"])
            self.assertEqual(query["include_extras"], ["true"])
            self.assertEqual(query["page"], ["2"])
            self.assertEqual(result, {"data": [card], "has_more": True})
            scryfall.search_tokens("Soldier pow:1", 2)
            self.assertEqual(fetch.call_count, 1)

    def test_no_results_and_retry_after_failure(self):
        with patch("scryfall._get_json", side_effect=scryfall.ScryfallError("No match", status=404)):
            self.assertEqual(scryfall.search_tokens("no match"), {"data": [], "has_more": False})
        with patch("scryfall._get_json", side_effect=[scryfall.ScryfallError("Offline"), {"data": []}]) as fetch:
            with self.assertRaises(scryfall.ScryfallError):
                scryfall.search_tokens("Treasure")
            self.assertEqual(scryfall.search_tokens("Treasure")["data"], [])
            self.assertEqual(fetch.call_count, 2)

if __name__ == "__main__":
    unittest.main()

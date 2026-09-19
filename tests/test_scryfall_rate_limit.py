"""Scryfall transport rate-limit behavior, without network access."""

import io
import unittest
import urllib.error
from unittest.mock import Mock, patch
from concurrent.futures import ThreadPoolExecutor

import scryfall


class ScryfallRateLimitTests(unittest.TestCase):
    def setUp(self):
        scryfall._last_request = 0.0
        scryfall._blocked_until = 0.0

    tearDown = setUp

    @staticmethod
    def rate_limit(retry_after=None):
        headers = {} if retry_after is None else {"Retry-After": retry_after}
        return urllib.error.HTTPError(
            "https://api.scryfall.com/cards/random", 429, "limited", headers,
            io.BytesIO(b""))

    def test_cooldown_blocks_requests_without_retry_and_expires(self):
        response = Mock()
        with patch("scryfall.time.monotonic", return_value=100) as clock, \
             patch("scryfall.urllib.request.urlopen", side_effect=[self.rate_limit("120"), response]) as fetch:
            with self.assertRaises(urllib.error.HTTPError):
                scryfall._urlopen("request")
            for _ in range(3):
                with self.assertRaises(scryfall.ScryfallError) as error:
                    scryfall._urlopen("request")
                self.assertEqual(error.exception.status, 429)
            self.assertEqual(fetch.call_count, 1)
            clock.return_value = 220
            self.assertIs(scryfall._urlopen("request"), response)
            self.assertEqual(fetch.call_count, 2)

    def test_retry_after_formats_and_conservative_fallback(self):
        for value, expected in ((None, 60), ("bad", 60), ("2", 60),
                                ("600", 600), ("nan", 60), ("inf", 60)):
            with self.subTest(value=value):
                self.assertEqual(scryfall._retry_delay(self.rate_limit(value)), expected)
        with patch("scryfall.time.time", return_value=0):
            self.assertEqual(scryfall._retry_delay(
                self.rate_limit("Thu, 01 Jan 1970 00:10:00 GMT")), 600)

    def test_concurrent_callers_stop_after_first_warning(self):
        def lookup(_):
            try:
                scryfall._get_json(scryfall.API + "/cards/random")
            except scryfall.ScryfallError as exc:
                return exc.status
        with patch("scryfall.urllib.request.urlopen", side_effect=self.rate_limit()) as fetch:
            with ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(list(pool.map(lookup, range(8))), [429] * 8)
        self.assertEqual(fetch.call_count, 1)

    def test_request_spacing_is_preserved(self):
        scryfall._last_request = 100
        with patch("scryfall.time.monotonic", side_effect=[100.1, 100.3]), \
             patch("scryfall.time.sleep") as sleep:
            scryfall._throttle()
        self.assertAlmostEqual(sleep.call_args.args[0], 0.1)


if __name__ == "__main__":
    unittest.main()

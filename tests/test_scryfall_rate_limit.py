"""Scryfall transport rate-limit behavior, without network access."""

import io
import unittest
import urllib.error
from unittest.mock import Mock, patch

import scryfall


class ScryfallRateLimitTests(unittest.TestCase):
    def setUp(self):
        scryfall._last_request = 0.0
        scryfall._blocked_until = 0.0

    @staticmethod
    def rate_limit(retry_after=None):
        headers = {} if retry_after is None else {"Retry-After": retry_after}
        return urllib.error.HTTPError(
            "https://api.scryfall.com/cards/random", 429, "limited", headers,
            io.BytesIO(b""))

    @patch("scryfall._throttle")
    @patch("scryfall._defer_requests")
    @patch("scryfall.urllib.request.urlopen")
    def test_retries_429_after_shared_cooldown(self, urlopen, defer, throttle):
        response = Mock()
        urlopen.side_effect = [self.rate_limit("2"), response]

        self.assertIs(scryfall._urlopen("request"), response)
        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(throttle.call_count, 2)
        defer.assert_called_once_with(2.0)

    @patch("scryfall._throttle")
    @patch("scryfall._defer_requests")
    @patch("scryfall.urllib.request.urlopen")
    def test_stops_after_bounded_number_of_retries(self, urlopen, defer, throttle):
        urlopen.side_effect = [self.rate_limit() for _ in range(4)]

        with self.assertRaises(urllib.error.HTTPError):
            scryfall._urlopen("request")
        self.assertEqual(urlopen.call_count, 4)
        self.assertEqual(defer.call_count, 3)


if __name__ == "__main__":
    unittest.main()

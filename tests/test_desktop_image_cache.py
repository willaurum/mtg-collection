"""Run with python -m unittest tests.test_desktop_image_cache."""

import io
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import patch

import desktop_image_cache
import scryfall


class DesktopImageCacheTests(unittest.TestCase):
    def test_app_accounts_use_one_app_data_image_folder(self):
        with patch.dict(os.environ, {"LOCALAPPDATA": r"C:\Users\Example\AppData\Local"}):
            self.assertEqual(desktop_image_cache.image_dir(),
                             r"C:\Users\Example\AppData\Local\MTGCardViewer\images")

    def test_download_once_into_one_local_folder(self):
        url = "https://cards.scryfall.io/normal/front/test.jpg"
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(scryfall, "CACHE_DIR", folder), \
                patch.object(scryfall, "_open", side_effect=lambda *_: io.BytesIO(b"art")) as download:
            server = desktop_image_cache.start()
            try:
                endpoint = "http://127.0.0.1:%d/img?u=%s" % (
                    server.server_port, urllib.parse.quote(url, safe=""))
                for _ in range(2):
                    with urllib.request.urlopen(endpoint) as response:
                        self.assertEqual(response.read(), b"art")
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(download.call_count, 1)
                self.assertEqual(len(os.listdir(folder)), 1)
                self.assertEqual(scryfall.clear_image_cache(), 1)
            finally:
                server.shutdown()
                server.server_close()

    def test_rejects_non_scryfall_urls(self):
        server = desktop_image_cache.start()
        try:
            endpoint = "http://127.0.0.1:%d/img?u=%s" % (
                server.server_port, urllib.parse.quote("http://example.com/private", safe=""))
            with self.assertRaises(urllib.error.HTTPError) as failure:
                urllib.request.urlopen(endpoint)
            self.assertEqual(failure.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()

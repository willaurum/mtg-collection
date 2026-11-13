"""Run with python -m unittest tests.test_desktop_server."""

import unittest

import desktop_app


class DesktopServerTests(unittest.TestCase):
    def test_fresh_install_uses_funnel(self):
        target, config = desktop_app.choose_server({})
        self.assertEqual(target, desktop_app.DEFAULT_SERVER)
        self.assertEqual(config, {})

    def test_old_private_address_moves_to_funnel(self):
        target, config = desktop_app.choose_server({"server": desktop_app.OLD_PRIVATE_SERVER})
        self.assertEqual(target, desktop_app.DEFAULT_SERVER)
        self.assertEqual(config["server"], desktop_app.DEFAULT_SERVER)

    def test_custom_address_is_kept(self):
        target, _ = desktop_app.choose_server({"server": "https://other.example"})
        self.assertEqual(target, "https://other.example")

    def test_local_stays_local_until_server_is_selected(self):
        target, config = desktop_app.choose_server({}, local=True)
        self.assertIsNone(target)
        self.assertIsNone(desktop_app.choose_server(config)[0])
        target, config = desktop_app.choose_server(config, server=desktop_app.DEFAULT_SERVER + "/")
        self.assertEqual(target, desktop_app.DEFAULT_SERVER)
        self.assertNotIn("local", config)


if __name__ == "__main__":
    unittest.main()

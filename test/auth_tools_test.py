import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("preserve", Path(__file__).parents[1] / "scripts/preserve-feed-auth.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
HASH = "sha256:" + base64.b64encode(bytes(range(32))).decode()
CONFIG = f'authInternalUsers:\n  - user: openirl-feed-1\n    pass: "{HASH}"\n    permissions:\n      - action: publish\n        path: live/feed-1\n  - user: any\n    pass:\n'

class MigrationTests(unittest.TestCase):
    def test_extract_only_named_user(self):
        self.assertEqual(module.extract_hash(CONFIG), HASH)
        for value in [CONFIG.replace("openirl-feed-1", "other"), CONFIG + CONFIG, CONFIG.replace(HASH, "plaintext")]:
            with self.assertRaises(ValueError):
                module.extract_hash(value)

    def test_preserve_and_refuse_conflicts(self):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as folder:
            os.chdir(folder)
            try:
                Path(".env").write_text("OBS_WEBSOCKET_PASSWORD=untouched\n")
                with patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=CONFIG)):
                    module.preserve("stash@{0}")
                    self.assertIn("OBS_WEBSOCKET_PASSWORD=untouched", Path(".env").read_text())
                    self.assertIn(HASH, Path(".env").read_text())
                    self.assertEqual(Path(".env").stat().st_mode & 0o777, 0o600)
                    self.assertEqual(Path(".env.before-feed-auth").stat().st_mode & 0o777, 0o600)
                    with self.assertRaises(FileExistsError):
                        module.preserve("stash@{0}")
                    Path(".env").write_text("FEED_1_PASSWORD_HASH=different\n")
                    with self.assertRaises(ValueError):
                        module.preserve("stash@{0}")
            finally:
                os.chdir(previous)

if __name__ == "__main__":
    unittest.main()

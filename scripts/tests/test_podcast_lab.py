import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import podcast_lab


class StageEpisodeTests(unittest.TestCase):
    def test_stages_variant_in_status_upload_layout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "script.txt").write_text("Host: Hi.\n")
            (root / "out").mkdir()
            (root / "out" / "a.wav").write_bytes(b"RIFF")
            spec = {"variants": [{"name": "a", "script": "script.txt"}]}

            podcast_lab.stage_episode(
                root / "out", root, spec, {"variant": "a", "title": "year one"}
            )

            episode = root / "out" / "episode"
            self.assertEqual((episode / "update.wav").read_bytes(), b"RIFF")
            self.assertEqual(
                (episode / "podcast_script.txt").read_text(), "Host: Hi.\n"
            )
            self.assertEqual((episode / "title.txt").read_text(), "year one")


if __name__ == "__main__":
    unittest.main()

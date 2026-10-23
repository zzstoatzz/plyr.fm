import importlib.util
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).parents[1] / "backfill_teal_plays.py"
SPEC = importlib.util.spec_from_file_location("backfill_teal_plays", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
backfill = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backfill)


class PlyrTrackIdTests(unittest.TestCase):
    def test_alpha_record_shape(self) -> None:
        value = {
            "musicServiceBaseDomain": "plyr.fm",
            "originUrl": "https://plyr.fm/track/1376",
        }
        self.assertEqual(backfill.plyr_track_id(value), 1376)

    def test_production_record_shape(self) -> None:
        value = {
            "musicServiceUri": "https://plyr.fm",
            "submissionClientAgent": "plyr.fm/1.0",
            "originUri": "https://plyr.fm/track/1370",
        }
        self.assertEqual(backfill.plyr_track_id(value), 1370)

    def test_localhost_origin_is_dropped(self) -> None:
        value = {
            "musicServiceBaseDomain": "plyr.fm",
            "originUrl": "http://localhost:5173/track/12",
        }
        self.assertIsNone(backfill.plyr_track_id(value))

    def test_other_services_are_dropped(self) -> None:
        value = {
            "musicServiceBaseDomain": "spotify.com",
            "originUrl": "https://open.spotify.com/track/abc",
        }
        self.assertIsNone(backfill.plyr_track_id(value))

    def test_plyr_link_without_plyr_marker_is_dropped(self) -> None:
        value = {"originUri": "https://plyr.fm/track/9"}
        self.assertIsNone(backfill.plyr_track_id(value))


if __name__ == "__main__":
    unittest.main()

"""record authorship must not constrain where a creator hosts their artwork.

origin trust is an ingest/display concern (`_internal/tasks/origin_trust.py`),
not a write-path one: what goes into a creator's own PDS record is their call.
regression for the portal PDS save failing on tracks whose imageUrl predates
the images.plyr.fm custom domain.
"""

import pytest

from backend._internal.atproto.records.fm_plyr.track import build_track_record


@pytest.mark.parametrize(
    "image_url",
    [
        "https://pub-308b393655d9474fa790a0ff4200a3ca.r2.dev/legacy.png",
        "https://images.plyr.fm/images/current.jpeg",
        "https://my-own-server.example.com/art.png",
    ],
)
async def test_build_track_record_accepts_any_image_origin(image_url: str) -> None:
    record = await build_track_record(
        title="test",
        artist="tester",
        file_type="m4a",
        audio_url="https://audio.plyr.fm/audio/abc.m4a",
        image_url=image_url,
    )
    assert record["imageUrl"] == image_url

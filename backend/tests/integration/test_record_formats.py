"""integration tests for /record page MediaRecorder output formats.

the /record page posts whatever the browser's MediaRecorder API gives us —
opus-in-webm on Chromium, opus-in-mp4 on Safari, opus-in-ogg on Firefox.
both webm and ogg containers are backend-side transcoded to mp3 via the
transcoder service; these tests exercise that full path against the real
staging API so an AudioFormat enum or transcoder regression surfaces in
CI rather than in production.

requires:
- ffmpeg installed (for generating opus-encoded fixtures)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from plyrfm import AsyncPlyrClient

pytestmark = [pytest.mark.integration, pytest.mark.timeout(180)]


async def test_upload_webm(user1_client: AsyncPlyrClient, drone_webm: Path):
    """upload opus-in-webm (Chromium MediaRecorder) — should transcode to MP3."""
    client = user1_client

    result = await client.upload(
        drone_webm,
        "Test WEBM Upload",
        tags={"integration-test", "record", "webm"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await client.get_track(track_id)
        assert track.title == "Test WEBM Upload"
        assert track.file_type == "mp3", f"expected mp3, got {track.file_type}"
    finally:
        await client.delete(track_id)


async def test_upload_ogg(user1_client: AsyncPlyrClient, drone_ogg: Path):
    """upload opus-in-ogg (Firefox MediaRecorder) — should transcode to MP3."""
    client = user1_client

    result = await client.upload(
        drone_ogg,
        "Test OGG Upload",
        tags={"integration-test", "record", "ogg"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await client.get_track(track_id)
        assert track.title == "Test OGG Upload"
        assert track.file_type == "mp3", f"expected mp3, got {track.file_type}"
    finally:
        await client.delete(track_id)

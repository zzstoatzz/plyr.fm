"""integration tests for lossless audio uploads (FLAC, AIFF, AIF).

FLAC is web-playable (Chrome 56+, Firefox 51+, Safari 11+) and stored directly.
AIFF still requires transcoding to MP3 for browser playback.

requires:
- ffmpeg installed (for generating test files)
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

pytestmark = [pytest.mark.integration, pytest.mark.timeout(180)]


async def test_upload_flac(user1_client: AsyncPlyrClient, drone_flac: Path):
    """upload FLAC file - stored directly as FLAC (web-playable, no transcoding)."""
    client = user1_client

    result = await client.upload(
        drone_flac,
        "Test FLAC Upload",
        tags={"integration-test", "lossless", "flac"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await client.get_track(track_id)
        assert track.title == "Test FLAC Upload"
        # FLAC is web-playable — stored directly, no transcoding
        assert track.file_type == "flac", f"expected flac, got {track.file_type}"

    finally:
        await client.delete(track_id)


async def test_upload_aiff(user1_client: AsyncPlyrClient, drone_aiff: Path):
    """upload AIFF file - should transcode to MP3."""
    client = user1_client

    result = await client.upload(
        drone_aiff,
        "Test AIFF Upload",
        tags={"integration-test", "lossless", "aiff"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await client.get_track(track_id)
        assert track.title == "Test AIFF Upload"
        assert track.file_type == "mp3", f"expected mp3, got {track.file_type}"

    finally:
        await client.delete(track_id)


async def test_upload_aif(user1_client: AsyncPlyrClient, drone_aif: Path):
    """upload AIF file (AIFF alias) - should transcode to MP3."""
    client = user1_client

    result = await client.upload(
        drone_aif,
        "Test AIF Upload",
        tags={"integration-test", "lossless", "aif"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await client.get_track(track_id)
        assert track.title == "Test AIF Upload"
        assert track.file_type == "mp3", f"expected mp3, got {track.file_type}"

    finally:
        await client.delete(track_id)

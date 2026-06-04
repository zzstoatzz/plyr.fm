"""integration tests for lossless audio uploads (FLAC, AIFF, AIF).

FLAC is web-playable (Chrome 56+, Firefox 51+, Safari 11+) and stored directly.
AIFF publishes immediately with the raw lossless source, then optimizes to MP3
in a background task for browser playback.

requires:
- ffmpeg installed (for generating test files)
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import pytest

from .conftest import IntegrationSettings

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

pytestmark = [pytest.mark.integration, pytest.mark.timeout(180)]

POLL_INTERVAL_SEC = 1.0
POLL_MAX_ATTEMPTS = 90


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _poll_until_file_type(
    client: AsyncPlyrClient,
    track_id: int,
    expected_file_type: str,
) -> Any:
    """wait for background optimization to swap the track to the target type."""
    for _ in range(POLL_MAX_ATTEMPTS):
        track = await client.get_track(track_id)
        if track.file_type == expected_file_type:
            return track
        await asyncio.sleep(POLL_INTERVAL_SEC)

    track = await client.get_track(track_id)
    raise AssertionError(
        f"track {track_id} did not become {expected_file_type} within "
        f"{POLL_MAX_ATTEMPTS * POLL_INTERVAL_SEC}s; still {track.file_type}"
    )


async def _wait_for_upload(
    http: httpx.AsyncClient,
    api_url: str,
    token: str,
    upload_id: str,
) -> int:
    """read upload SSE until the upload job completes and returns a track id."""
    async with http.stream(
        "GET",
        f"{api_url}/tracks/uploads/{upload_id}/progress",
        headers=_auth_headers(token),
    ) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue

            payload = json.loads(line.removeprefix("data: "))
            status = payload.get("status")
            if status == "completed":
                return int(payload["track_id"])
            if status == "failed":
                raise AssertionError(
                    f"upload {upload_id} failed: {payload.get('error')}"
                )

    raise AssertionError(f"upload {upload_id} stream ended without completion")


async def _upload_support_gated_track(
    http: httpx.AsyncClient,
    api_url: str,
    token: str,
    audio_path: Path,
    title: str,
) -> int:
    """upload a supporter-gated track via raw HTTP; the SDK lacks support_gate."""
    with audio_path.open("rb") as audio_file:
        response = await http.post(
            f"{api_url}/tracks/",
            headers=_auth_headers(token),
            data={
                "title": title,
                "tags": json.dumps(["integration-test", "lossless", "gated"]),
                "support_gate": json.dumps({"type": "any"}),
            },
            files={
                "file": (
                    audio_path.name,
                    audio_file,
                    "audio/aiff",
                )
            },
        )
    response.raise_for_status()
    upload_id = response.json()["upload_id"]
    return await _wait_for_upload(http, api_url, token, upload_id)


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
    """upload AIFF file - should eventually optimize to MP3."""
    client = user1_client

    result = await client.upload(
        drone_aiff,
        "Test AIFF Upload",
        tags={"integration-test", "lossless", "aiff"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await _poll_until_file_type(client, track_id, "mp3")
        assert track.title == "Test AIFF Upload"
        assert track.file_type == "mp3", f"expected mp3, got {track.file_type}"

    finally:
        await client.delete(track_id)


async def test_upload_aif(user1_client: AsyncPlyrClient, drone_aif: Path):
    """upload AIF file (AIFF alias) - should eventually optimize to MP3."""
    client = user1_client

    result = await client.upload(
        drone_aif,
        "Test AIF Upload",
        tags={"integration-test", "lossless", "aif"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        track = await _poll_until_file_type(client, track_id, "mp3")
        assert track.title == "Test AIF Upload"
        assert track.file_type == "mp3", f"expected mp3, got {track.file_type}"

    finally:
        await client.delete(track_id)


async def test_upload_support_gated_aiff_optimizes_to_private_mp3(
    user1_client: AsyncPlyrClient,
    integration_settings: IntegrationSettings,
    drone_aiff: Path,
):
    """supporter-gated AIFF should publish, optimize, and stay private.

    This covers the #1408 path end-to-end: support_gate routes the source to
    private storage, the optimizer reads from that private source, writes the
    MP3 back to private storage, and the track record keeps a backend /audio URL
    instead of a public R2 URL.
    """
    assert integration_settings.token_1

    client = user1_client
    api_url = integration_settings.api_url
    token = integration_settings.token_1
    track_id: int | None = None

    async with httpx.AsyncClient(timeout=300.0) as http:
        prefs_response = await http.get(
            f"{api_url}/preferences/", headers=_auth_headers(token)
        )
        prefs_response.raise_for_status()
        previous_support_url = prefs_response.json().get("support_url")

        try:
            enable_response = await http.post(
                f"{api_url}/preferences/",
                headers=_auth_headers(token),
                json={"support_url": "atprotofans"},
            )
            enable_response.raise_for_status()

            track_id = await _upload_support_gated_track(
                http,
                api_url,
                token,
                drone_aiff,
                "Test Support-Gated AIFF Upload",
            )
            track = await _poll_until_file_type(client, track_id, "mp3")

            assert track.title == "Test Support-Gated AIFF Upload"
            assert track.file_type == "mp3"
            assert track.support_gate == {"type": "any"}
            assert track.r2_url is None
            assert track.audio_storage == "r2"
            assert track.pds_blob_cid is None
            assert track.original_file_id is not None
            assert track.original_file_type == "aiff"

        finally:
            if track_id is not None:
                await client.delete(track_id)

            restore_response = await http.post(
                f"{api_url}/preferences/",
                headers=_auth_headers(token),
                json={"support_url": previous_support_url or ""},
            )
            restore_response.raise_for_status()

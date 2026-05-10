"""regression test: long-form audio uploads must complete end-to-end.

context — 2026-05-06 → 2026-05-10 prod outage: the docket worker buffered
the entire audio file in memory at multiple points (R2 → worker, transcode
result, PDS uploadBlob, CLAP embedding). on a 90-minute upload that pile
of buffers crossed the worker's 2GB cap, the worker OOM'd, fly's
on-failure restart policy gave up after 10 retries, and uploads were
broken for ~4 days before a user noticed.

the fix shipped streaming everywhere. this test is the regression guard:
upload an audio file long enough that any reintroduced buffer would OOM
the worker, and assert the upload reaches `completed`. if a future change
re-buffers the file, this test fails on the merge that introduced it
instead of on a user's tweet.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from .conftest import IntegrationSettings
from .utils.audio import save_longform_drone

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

# 60 min @ 22.05 kHz mono 16-bit ≈ 150 MB on disk. enough to OOM a 2 GB
# worker if the upload pipeline buffers even one or two copies of the
# file (which it did before this PR), but small enough to upload through
# CI in a few minutes. timeout headroom: 1200s for the slow path —
# multipart upload + transcode (no-op for WAV) + R2 staging + PDS upload
# + scanners + ATProto record creation.
LONGFORM_DURATION_SEC = 60 * 60
LONGFORM_TIMEOUT_SEC = 1200.0

pytestmark = [pytest.mark.integration, pytest.mark.timeout(int(LONGFORM_TIMEOUT_SEC))]


@pytest.fixture(scope="session")
def longform_wav(
    tmp_path_factory: pytest.TempPathFactory,
    integration_settings: IntegrationSettings,
) -> Path:
    """generate a single 60-minute mono WAV for the test session.

    skips ahead of the ffmpeg shell-out when the integration env can't run:
    the regular backend `test` workflow collects this file (no `-m
    integration` filter) but doesn't have ffmpeg installed and doesn't have
    `PLYR_TEST_TOKEN_1`, so eagerly invoking `ffmpeg` here would explode
    the unrelated check. session-scoped so we don't pay the 150 MB write
    cost more than once if we add additional long-form tests later.
    """
    if not integration_settings.has_primary_token:
        pytest.skip("PLYR_TEST_TOKEN_1 not set")
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not available; long-form fixture cannot be generated")
    path = tmp_path_factory.mktemp("longform") / "drone_60min.wav"
    return save_longform_drone(path, duration_sec=LONGFORM_DURATION_SEC)


async def test_longform_upload_completes(
    user1_client: AsyncPlyrClient, longform_wav: Path
) -> None:
    """uploading a 60-min WAV must reach `completed`, not stall in `processing`.

    fails-loud regression check for the worker-OOM class of bugs: any
    buffer-the-whole-file reintroduction in the upload pipeline will OOM
    the worker on a file this size, the upload will never transition to
    `completed`, and this test will time out.
    """
    client = user1_client
    file_size_mb = longform_wav.stat().st_size / (1024 * 1024)
    assert file_size_mb > 100, (
        f"longform fixture must be > 100MB to exercise streaming; got {file_size_mb:.0f}MB"
    )

    with open(longform_wav, "rb") as f:
        post_response = await client._client.post(
            client._url("/tracks/"),
            headers=client._auth_headers,
            files={"file": (longform_wav.name, f)},
            data={
                "title": "longform streaming regression",
                "tags": json.dumps(["integration-test", "longform-regression"]),
            },
            timeout=LONGFORM_TIMEOUT_SEC,
        )
    post_response.raise_for_status()
    upload_id = post_response.json()["upload_id"]

    track_id: int | None = None
    try:
        async with client._client.stream(
            "GET",
            client._url(f"/tracks/uploads/{upload_id}/progress"),
            headers=client._auth_headers,
            timeout=LONGFORM_TIMEOUT_SEC,
        ) as stream:
            async for line in stream.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = json.loads(line[6:])
                status = payload.get("status")
                if status == "completed":
                    track_id = int(payload["track_id"])
                    break
                if status == "failed":
                    raise ValueError(
                        f"longform upload failed: {payload.get('error', 'unknown')}"
                    )
        assert track_id is not None, "upload stream ended without a terminal event"

        track = await client.get_track(track_id)
        assert track.title == "longform streaming regression"
    finally:
        if track_id is not None:
            await client.delete(track_id)

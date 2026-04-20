"""integration tests for audio replace + revisions + restore.

these run against a real backend (default: staging) using dev tokens. they
seed via the SDK, then exercise the new /tracks/{id}/audio (replace) and
/tracks/{id}/revisions(/restore) endpoints with raw httpx — the SDK doesn't
have wrappers for those yet.

each test cleans up after itself by deleting the seeded track.

prereqs:
- staging deployed with the track_revisions migration applied
- PLYR_TEST_TOKEN_1 (and TOKEN_2 for the owner-only test) set
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest

from .conftest import IntegrationSettings

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient


pytestmark = [pytest.mark.integration, pytest.mark.timeout(180)]


# replace + restore each kick off background work. polling cap chosen for
# typical staging round-trip times (transcode + R2 + PDS write usually <30s).
POLL_INTERVAL_SEC = 1.0
POLL_MAX_ATTEMPTS = 60


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _poll_until_file_id_changes(
    http: httpx.AsyncClient,
    api_url: str,
    token: str,
    track_id: int,
    original_file_id: str,
) -> str:
    """poll GET /tracks/{id} until file_id changes (or time out).

    audio replace runs in a background task; this is the simplest way for the
    test to wait for it without subscribing to SSE.
    """
    for _ in range(POLL_MAX_ATTEMPTS):
        resp = await http.get(
            f"{api_url}/tracks/{track_id}", headers=_auth_headers(token)
        )
        resp.raise_for_status()
        current_file_id = resp.json()["file_id"]
        if current_file_id != original_file_id:
            return current_file_id
        await asyncio.sleep(POLL_INTERVAL_SEC)
    raise AssertionError(
        f"file_id did not change within {POLL_MAX_ATTEMPTS * POLL_INTERVAL_SEC}s "
        f"(track {track_id}, still at {original_file_id})"
    )


async def _list_revisions(
    http: httpx.AsyncClient, api_url: str, token: str, track_id: int
) -> list[dict]:
    resp = await http.get(
        f"{api_url}/tracks/{track_id}/revisions", headers=_auth_headers(token)
    )
    resp.raise_for_status()
    body = resp.json()
    return body["revisions"]


async def test_replace_audio_creates_revision(
    user1_client: AsyncPlyrClient,
    integration_settings: IntegrationSettings,
    drone_a4: Path,
    drone_e4: Path,
):
    """upload → replace audio with a different file → revision list contains
    exactly one row capturing the original audio."""
    client = user1_client
    api_url = integration_settings.api_url
    assert integration_settings.token_1
    token = integration_settings.token_1

    upload = await client.upload(
        drone_a4,
        "integration: replace creates revision",
        tags={"integration-test", "audio-revisions"},
    )
    track_id = upload.track_id
    try:
        original = await client.get_track(track_id)
        original_file_id = original.file_id

        # before any replace: history is empty
        async with httpx.AsyncClient(timeout=60.0) as http:
            revisions_before = await _list_revisions(http, api_url, token, track_id)
            assert revisions_before == []

            # replace via raw httpx (SDK has no wrapper yet)
            with drone_e4.open("rb") as f:
                files = {"file": ("drone_e4.wav", f, "audio/wav")}
                replace_resp = await http.put(
                    f"{api_url}/tracks/{track_id}/audio",
                    files=files,
                    headers=_auth_headers(token),
                )
            replace_resp.raise_for_status()

            # wait for the background task to land
            new_file_id = await _poll_until_file_id_changes(
                http, api_url, token, track_id, original_file_id
            )
            assert new_file_id != original_file_id

            # exactly one revision now exists, capturing the displaced original
            revisions_after = await _list_revisions(http, api_url, token, track_id)
            assert len(revisions_after) == 1
            rev = revisions_after[0]
            assert rev["track_id"] == track_id
            assert rev["file_type"] == "wav"
            assert rev["was_gated"] is False
            # response shape is intentionally narrow — file_id stays internal
            assert "file_id" not in rev
            assert "audio_url" not in rev
    finally:
        await client.delete(track_id)


async def test_restore_swaps_audio_and_rotates_revision(
    user1_client: AsyncPlyrClient,
    integration_settings: IntegrationSettings,
    drone_a4: Path,
    drone_e4: Path,
):
    """upload → replace → restore the displaced version. the original audio is
    live again, the chosen revision row is gone, and the displaced post-replace
    audio is now in history."""
    client = user1_client
    api_url = integration_settings.api_url
    assert integration_settings.token_1
    token = integration_settings.token_1

    upload = await client.upload(
        drone_a4,
        "integration: restore rotates revision",
        tags={"integration-test", "audio-revisions"},
    )
    track_id = upload.track_id
    try:
        original = await client.get_track(track_id)
        original_file_id = original.file_id

        async with httpx.AsyncClient(timeout=60.0) as http:
            with drone_e4.open("rb") as f:
                files = {"file": ("drone_e4.wav", f, "audio/wav")}
                replace_resp = await http.put(
                    f"{api_url}/tracks/{track_id}/audio",
                    files=files,
                    headers=_auth_headers(token),
                )
            replace_resp.raise_for_status()

            replaced_file_id = await _poll_until_file_id_changes(
                http, api_url, token, track_id, original_file_id
            )

            revisions = await _list_revisions(http, api_url, token, track_id)
            assert len(revisions) == 1
            chosen_revision_id = revisions[0]["id"]

            # restore the displaced original
            restore_resp = await http.post(
                f"{api_url}/tracks/{track_id}/revisions/{chosen_revision_id}/restore",
                headers=_auth_headers(token),
            )
            restore_resp.raise_for_status()
            snapshot_payload = restore_resp.json()
            # the response is the snapshot of the audio that was just displaced
            assert snapshot_payload["track_id"] == track_id
            assert snapshot_payload["id"] != chosen_revision_id

            # the live track should now point back at the original file_id
            # (restore is sync — no polling needed)
            after_restore = (
                await http.get(
                    f"{api_url}/tracks/{track_id}", headers=_auth_headers(token)
                )
            ).json()
            assert after_restore["file_id"] == original_file_id

            # history now contains exactly one row: the displaced post-replace
            # audio. the original (chosen) row was deleted on restore.
            revisions_after = await _list_revisions(http, api_url, token, track_id)
            assert len(revisions_after) == 1
            assert revisions_after[0]["id"] != chosen_revision_id
            assert revisions_after[0]["id"] == snapshot_payload["id"]
            del replaced_file_id  # asserted indirectly via the snapshot id mapping
    finally:
        await client.delete(track_id)


async def test_non_owner_cannot_list_or_restore(
    user1_client: AsyncPlyrClient,
    user2_client: AsyncPlyrClient,
    integration_settings: IntegrationSettings,
    drone_a4: Path,
    drone_e4: Path,
):
    """user2 must not be able to list user1's revisions OR restore one. this
    also doubles as a smoke that the dev token surface enforces ownership."""
    api_url = integration_settings.api_url
    assert integration_settings.token_1
    assert integration_settings.token_2
    token1 = integration_settings.token_1
    token2 = integration_settings.token_2
    del user2_client  # only used to surface the multi-user skip via the fixture

    upload = await user1_client.upload(
        drone_a4,
        "integration: ownership check on revisions",
        tags={"integration-test", "audio-revisions"},
    )
    track_id = upload.track_id
    try:
        async with httpx.AsyncClient(timeout=60.0) as http:
            # produce one revision so there's something for user2 to try to
            # restore
            original_file_id = (
                await http.get(
                    f"{api_url}/tracks/{track_id}", headers=_auth_headers(token1)
                )
            ).json()["file_id"]
            with drone_e4.open("rb") as f:
                files = {"file": ("drone_e4.wav", f, "audio/wav")}
                await http.put(
                    f"{api_url}/tracks/{track_id}/audio",
                    files=files,
                    headers=_auth_headers(token1),
                )
            await _poll_until_file_id_changes(
                http, api_url, token1, track_id, original_file_id
            )
            revs = await _list_revisions(http, api_url, token1, track_id)
            assert len(revs) == 1
            revision_id = revs[0]["id"]

            # user2: cannot list
            list_resp = await http.get(
                f"{api_url}/tracks/{track_id}/revisions",
                headers=_auth_headers(token2),
            )
            assert list_resp.status_code == 403

            # user2: cannot restore
            restore_resp = await http.post(
                f"{api_url}/tracks/{track_id}/revisions/{revision_id}/restore",
                headers=_auth_headers(token2),
            )
            assert restore_resp.status_code == 403
    finally:
        await user1_client.delete(track_id)

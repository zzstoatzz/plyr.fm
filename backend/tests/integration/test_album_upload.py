"""integration tests for the multi-track album upload flow.

exercises the full create → upload → finalize → verify loop against a
real (staging) backend. regression coverage for #1260 — the PR that
switched album uploads to the first-class album_id + finalize flow.

these tests use raw HTTP via the SDK's internal httpx client because
the SDK's upload() method doesn't expose the new album_id form field
or the atproto_uri/atproto_cid SSE completion fields.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

pytestmark = [pytest.mark.integration, pytest.mark.timeout(180)]


async def _create_album(
    client: AsyncPlyrClient,
    *,
    title: str,
    description: str | None = None,
) -> dict[str, Any]:
    """POST /albums/ via raw http. returns the album metadata payload."""
    body: dict[str, Any] = {"title": title}
    if description:
        body["description"] = description
    response = await client._client.post(
        client._url("/albums/"),
        headers=client._auth_headers,
        json=body,
    )
    response.raise_for_status()
    return response.json()


async def _upload_track_with_album_id(
    client: AsyncPlyrClient,
    *,
    file: Path,
    title: str,
    album_id: str,
    tags: set[str],
    timeout: float = 120.0,
) -> int:
    """POST /tracks/ with an explicit album_id form field, then poll the
    SSE progress stream for completion. returns the created track id.

    the SDK's upload() helper doesn't know about album_id, so we drive
    the raw multipart request and SSE polling here.
    """
    with open(file, "rb") as f:
        files = {"file": (file.name, f)}
        data: dict[str, str] = {
            "title": title,
            "album_id": album_id,
            "tags": json.dumps(list(tags)),
        }
        post_response = await client._client.post(
            client._url("/tracks/"),
            headers=client._auth_headers,
            files=files,
            data=data,
            timeout=timeout,
        )
    post_response.raise_for_status()
    upload_id = post_response.json()["upload_id"]

    # poll SSE for completion
    async with client._client.stream(
        "GET",
        client._url(f"/tracks/uploads/{upload_id}/progress"),
        headers=client._auth_headers,
        timeout=timeout,
    ) as stream:
        async for line in stream.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = json.loads(line[6:])
            status = payload.get("status")
            if status == "completed":
                track_id = payload.get("track_id")
                assert track_id is not None, (
                    f"completed event missing track_id: {payload}"
                )
                # regression: SSE completion must surface atproto_uri/cid so
                # the frontend can build strongRefs for finalize
                assert "atproto_uri" in payload, (
                    f"completed event missing atproto_uri: {payload}"
                )
                assert "atproto_cid" in payload, (
                    f"completed event missing atproto_cid: {payload}"
                )
                return int(track_id)
            if status == "failed":
                raise ValueError(
                    f"track upload failed: {payload.get('error', 'unknown')}"
                )
    raise ValueError("upload stream ended without completion")


async def _finalize_album(
    client: AsyncPlyrClient,
    *,
    album_id: str,
    track_ids: list[int],
) -> dict[str, Any]:
    """POST /albums/{id}/finalize via raw http. returns album metadata."""
    response = await client._client.post(
        client._url(f"/albums/{album_id}/finalize"),
        headers=client._auth_headers,
        json={"track_ids": track_ids},
    )
    response.raise_for_status()
    return response.json()


async def _delete_album_cascade(
    client: AsyncPlyrClient,
    *,
    album_id: str,
) -> None:
    """delete an album and all its tracks — cleanup helper for integration
    tests. fails silently on 404 so double-cleanup doesn't break teardown."""
    response = await client._client.delete(
        client._url(f"/albums/{album_id}?cascade=true"),
        headers=client._auth_headers,
    )
    if response.status_code == 404:
        return
    response.raise_for_status()


async def test_album_upload_preserves_finalize_order(
    user1_client: AsyncPlyrClient,
    drone_a4: Path,
    drone_c4: Path,
    drone_e4: Path,
) -> None:
    """full album upload flow: create shell, upload tracks in one order,
    finalize in the REVERSE order, verify the album returns tracks in
    finalize order (not upload order).

    regression for #1260: under concurrent uploads the list record was
    built by per-track sync tasks sorting by Track.created_at, so user-
    intended order was lost. finalize must be the authoritative source
    of order at upload time.
    """
    client = user1_client
    album_id: str | None = None
    try:
        # step 1: create album shell
        album = await _create_album(
            client,
            title="Integration Test Album (Ordering)",
            description="created by test_album_upload_preserves_finalize_order",
        )
        album_id = album["id"]
        assert album_id is not None
        assert album["track_count"] == 0
        assert album["list_uri"] is None

        # step 2: upload three tracks in upload order A → C → E
        # (sequential via await — intentionally not concurrent so ordering
        # by created_at is predictable; this makes the regression assertion
        # stronger because finalize-order must still override created_at)
        track_a = await _upload_track_with_album_id(
            client,
            file=drone_a4,
            title="Integration Ordering — First Uploaded (A4)",
            album_id=album_id,
            tags={"integration-test", "album-ordering"},
        )
        track_c = await _upload_track_with_album_id(
            client,
            file=drone_c4,
            title="Integration Ordering — Second Uploaded (C4)",
            album_id=album_id,
            tags={"integration-test", "album-ordering"},
        )
        track_e = await _upload_track_with_album_id(
            client,
            file=drone_e4,
            title="Integration Ordering — Third Uploaded (E4)",
            album_id=album_id,
            tags={"integration-test", "album-ordering"},
        )

        # step 3: finalize with REVERSE order — E4 → C4 → A4
        finalize_order = [track_e, track_c, track_a]
        finalized = await _finalize_album(
            client, album_id=album_id, track_ids=finalize_order
        )
        assert finalized["list_uri"] is not None, (
            "finalize must write an ATProto list record"
        )

        # step 4: GET the album and verify tracks come back in finalize order,
        # not upload order. the public detail endpoint reads from the list
        # record's items[] array.
        artist_handle = finalized["artist_handle"]
        slug = finalized["slug"]
        detail_response = await client._client.get(
            client._url(f"/albums/{artist_handle}/{slug}"),
            headers=client._auth_headers,
        )
        detail_response.raise_for_status()
        detail = detail_response.json()

        returned_ids = [t["id"] for t in detail["tracks"]]
        assert returned_ids == finalize_order, (
            f"album tracks must follow finalize order {finalize_order}, "
            f"got {returned_ids}"
        )
    finally:
        if album_id:
            await _delete_album_cascade(client, album_id=album_id)


async def test_album_finalize_preserves_existing_tracks_on_append(
    user1_client: AsyncPlyrClient,
    drone_a4: Path,
    drone_c4: Path,
) -> None:
    """upload one track to a brand-new album, then upload a second track
    referencing the same album (via the idempotent create → add flow),
    and verify the final list record contains BOTH tracks.

    regression for the claim-2 fix in the external review of #1260:
    finalize used to replace the list record with exactly the requested
    track_ids, which truncated prior tracks when appending to an existing
    album. now finalize must preserve tracks already on the album.
    """
    client = user1_client
    album_id: str | None = None
    try:
        # session 1: create album + upload first track + finalize
        album_1 = await _create_album(client, title="Integration Test Album (Append)")
        album_id = album_1["id"]
        assert album_id is not None

        track_a = await _upload_track_with_album_id(
            client,
            file=drone_a4,
            title="Integration Append — Session 1 Track (A4)",
            album_id=album_id,
            tags={"integration-test", "album-append"},
        )
        finalized_1 = await _finalize_album(
            client, album_id=album_id, track_ids=[track_a]
        )
        assert finalized_1["list_uri"] is not None

        # session 2: "re-create" the album with the same title — idempotent
        # path returns the existing album row, mirroring the UX where a user
        # types an existing album name on the upload form to add more tracks
        album_2 = await _create_album(client, title="Integration Test Album (Append)")
        assert album_2["id"] == album_id, (
            "create_album must be idempotent on duplicate title"
        )

        track_c = await _upload_track_with_album_id(
            client,
            file=drone_c4,
            title="Integration Append — Session 2 Track (C4)",
            album_id=album_id,
            tags={"integration-test", "album-append"},
        )
        # finalize the SECOND session with ONLY the new track.
        # pre-fix behavior would have truncated the list record to [track_c];
        # post-fix must preserve track_a and append track_c.
        await _finalize_album(client, album_id=album_id, track_ids=[track_c])

        # GET the album and verify both tracks are present, with track_a
        # preserved from session 1 and track_c appended
        artist_handle = album_2["artist_handle"]
        slug = album_2["slug"]
        detail_response = await client._client.get(
            client._url(f"/albums/{artist_handle}/{slug}"),
            headers=client._auth_headers,
        )
        detail_response.raise_for_status()
        detail = detail_response.json()

        returned_ids = [t["id"] for t in detail["tracks"]]
        assert track_a in returned_ids, (
            f"existing track {track_a} must be preserved after append finalize, "
            f"got {returned_ids}"
        )
        assert track_c in returned_ids, (
            f"new track {track_c} must be appended, got {returned_ids}"
        )
        # preserved-then-new order: track_a first, then track_c
        assert returned_ids.index(track_a) < returned_ids.index(track_c), (
            f"preserved tracks must appear before newly-appended tracks, "
            f"got {returned_ids}"
        )
    finally:
        if album_id:
            await _delete_album_cascade(client, album_id=album_id)

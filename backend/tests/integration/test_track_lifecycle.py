"""integration tests for track lifecycle: upload, edit, delete.

these tests exercise the full track CRUD workflow using the plyrfm SDK.
each test is self-cleaning: it creates data, verifies it, then deletes it.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

pytestmark = [pytest.mark.integration, pytest.mark.timeout(120)]


async def test_upload_verify_delete(user1_client: AsyncPlyrClient, drone_a4: Path):
    """basic lifecycle: upload a track, verify it exists, then delete it."""
    client = user1_client

    # upload
    result = await client.upload(
        drone_a4,
        "Test Drone A4",
        tags={"integration-test", "drone"},
    )
    track_id = result.track_id
    assert track_id is not None

    try:
        # verify upload succeeded
        track = await client.get_track(track_id)
        assert track.title == "Test Drone A4"
        assert "integration-test" in track.tags
        assert "drone" in track.tags
        assert track.file_type == "wav"

    finally:
        # always cleanup
        await client.delete(track_id)

        # verify deletion
        with pytest.raises(Exception):  # noqa: B017
            await client.get_track(track_id)


async def test_upload_edit_title(user1_client: AsyncPlyrClient, drone_e4: Path):
    """upload a track and edit its title."""
    from plyrfm._internal.types import TrackPatch

    client = user1_client

    # upload
    result = await client.upload(
        drone_e4,
        "Test Drone E4 - Original",
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # verify original title
        track = await client.get_track(track_id)
        assert track.title == "Test Drone E4 - Original"

        # edit title
        updated = await client.update_track(
            track_id,
            TrackPatch(title="Test Drone E4 - Edited"),
        )
        assert updated.title == "Test Drone E4 - Edited"

        # verify edit persisted
        track = await client.get_track(track_id)
        assert track.title == "Test Drone E4 - Edited"

    finally:
        await client.delete(track_id)


async def test_upload_edit_tags(user1_client: AsyncPlyrClient, drone_c4: Path):
    """upload a track and edit its tags."""
    from plyrfm._internal.types import TrackPatch

    client = user1_client

    # upload with initial tags
    result = await client.upload(
        drone_c4,
        "Test Drone C4",
        tags={"integration-test", "original-tag"},
    )
    track_id = result.track_id

    try:
        # verify initial tags
        track = await client.get_track(track_id)
        assert "integration-test" in track.tags
        assert "original-tag" in track.tags

        # edit tags
        updated = await client.update_track(
            track_id,
            TrackPatch(tags=["integration-test", "new-tag", "another-tag"]),
        )
        assert "new-tag" in updated.tags
        assert "another-tag" in updated.tags

    finally:
        await client.delete(track_id)


async def test_upload_appears_in_my_tracks(
    user1_client: AsyncPlyrClient,
    drone_a4: Path,
):
    """uploaded track appears in user's track list."""
    client = user1_client

    result = await client.upload(
        drone_a4,
        "Test Drone - My Tracks",
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # verify track appears in my_tracks
        my_tracks = await client.my_tracks(limit=100)
        track_ids = [t.id for t in my_tracks]
        assert track_id in track_ids

    finally:
        await client.delete(track_id)


async def test_upload_searchable(user1_client: AsyncPlyrClient, drone_a4: Path):
    """uploaded track is searchable after upload."""
    import asyncio

    client = user1_client

    # use unique title for search
    unique_title = "TestDroneSearchable12345"

    result = await client.upload(
        drone_a4,
        unique_title,
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # search may take a moment to index - retry a few times
        found = False
        for _ in range(5):
            search_result = await client.search(unique_title, type="tracks")
            # search results are in search_result.results, filter for tracks
            for item in search_result.results:
                if item.type == "track" and item.id == track_id:
                    found = True
                    break
            if found:
                break
            await asyncio.sleep(1)

        assert found, f"track {track_id} not found in search results"

    finally:
        await client.delete(track_id)

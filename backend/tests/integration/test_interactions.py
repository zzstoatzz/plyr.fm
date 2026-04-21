"""integration tests for cross-user interactions.

tests that require multiple authenticated users:
- likes between users
- permission boundaries (can't edit others' tracks)
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

pytestmark = [pytest.mark.integration, pytest.mark.timeout(120)]


async def test_cross_user_like(
    user1_client: AsyncPlyrClient,
    user2_client: AsyncPlyrClient,
    drone_a4: Path,
):
    """user2 can like and unlike user1's track."""
    client1 = user1_client
    client2 = user2_client

    # user1 uploads a track
    result = await client1.upload(
        drone_a4,
        "Test Drone - Cross User Like",
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # get initial like count
        track = await client1.get_track(track_id)
        initial_likes = track.like_count

        # user2 likes the track
        await client2.like(track_id)

        # verify like count increased
        track = await client1.get_track(track_id)
        assert track.like_count == initial_likes + 1

        # verify track appears in user2's liked tracks
        liked = await client2.liked_tracks(limit=100)
        liked_ids = [t.id for t in liked]
        assert track_id in liked_ids

        # user2 unlikes the track
        await client2.unlike(track_id)

        # verify like count decreased
        track = await client1.get_track(track_id)
        assert track.like_count == initial_likes

        # verify track no longer in user2's liked tracks
        liked = await client2.liked_tracks(limit=100)
        liked_ids = [t.id for t in liked]
        assert track_id not in liked_ids

    finally:
        await client1.delete(track_id)


async def test_cannot_delete_others_track(
    user1_client: AsyncPlyrClient,
    user2_client: AsyncPlyrClient,
    drone_e4: Path,
):
    """user2 cannot delete user1's track."""
    client1 = user1_client
    client2 = user2_client

    # user1 uploads a track
    result = await client1.upload(
        drone_e4,
        "Test Drone - Cannot Delete",
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # user2 tries to delete - should fail
        with pytest.raises(Exception) as exc_info:
            await client2.delete(track_id)

        # verify it's a permission error (403 or similar)
        assert (
            "403" in str(exc_info.value) or "forbidden" in str(exc_info.value).lower()
        )

        # verify track still exists
        track = await client1.get_track(track_id)
        assert track.id == track_id

    finally:
        # user1 cleans up
        await client1.delete(track_id)


async def test_cannot_edit_others_track(
    user1_client: AsyncPlyrClient,
    user2_client: AsyncPlyrClient,
    drone_c4: Path,
):
    """user2 cannot edit user1's track."""
    from plyrfm._internal.types import TrackPatch

    client1 = user1_client
    client2 = user2_client

    # user1 uploads a track
    result = await client1.upload(
        drone_c4,
        "Test Drone - Cannot Edit",
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # user2 tries to edit - should fail
        with pytest.raises(Exception) as exc_info:
            await client2.update_track(
                track_id,
                TrackPatch(title="Malicious Edit"),
            )

        # verify it's a permission error
        assert (
            "403" in str(exc_info.value) or "forbidden" in str(exc_info.value).lower()
        )

        # verify title unchanged
        track = await client1.get_track(track_id)
        assert track.title == "Test Drone - Cannot Edit"

    finally:
        await client1.delete(track_id)


async def test_public_track_visibility(
    user1_client: AsyncPlyrClient,
    user2_client: AsyncPlyrClient,
    drone_a4: Path,
):
    """tracks uploaded by user1 are visible to user2."""
    client1 = user1_client
    client2 = user2_client

    # user1 uploads a track
    result = await client1.upload(
        drone_a4,
        "Test Drone - Public Visibility",
        tags={"integration-test"},
    )
    track_id = result.track_id

    try:
        # user2 can see the track
        track = await client2.get_track(track_id)
        assert track.id == track_id
        assert track.title == "Test Drone - Public Visibility"

    finally:
        await client1.delete(track_id)

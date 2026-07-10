"""shared track helpers for staging integration tests."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient

POLL_INTERVAL_SEC = 1.0
POLL_MAX_ATTEMPTS = 90


async def poll_until_file_type(
    client: AsyncPlyrClient,
    track_id: int,
    expected_file_type: str,
) -> Any:
    """wait for the deferred optimize task to swap the track to the target type."""
    for _ in range(POLL_MAX_ATTEMPTS):
        track = await client.tracks.get(track_id)
        if track.file_type == expected_file_type:
            return track
        await asyncio.sleep(POLL_INTERVAL_SEC)

    track = await client.tracks.get(track_id)
    raise AssertionError(
        f"track {track_id} did not become {expected_file_type} within "
        f"{POLL_MAX_ATTEMPTS * POLL_INTERVAL_SEC}s; still {track.file_type}"
    )

"""now playing service for real-time playback state.

exposes current playback state for external integrations like teal.fm/Piper.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from cachetools import TTLCache

logger = logging.getLogger(__name__)

# playback state expires after 5 minutes of no updates
# this handles cases where user closes browser without explicit stop
NOW_PLAYING_TTL_SECONDS = 300


@dataclass
class NowPlayingState:
    """current playback state for a user."""

    # track metadata
    track_name: str
    artist_name: str
    album_name: str | None
    duration_ms: int
    progress_ms: int

    # track identifiers
    track_id: int
    file_id: str

    # plyr.fm URLs
    track_url: str  # e.g., https://plyr.fm/track/123
    image_url: str | None

    # playback state
    is_playing: bool
    updated_at: datetime


class NowPlayingService:
    """service for tracking real-time playback state.

    uses TTL cache - playback state expires after 5 minutes of no updates.
    this is ephemeral data, no database persistence needed.
    """

    def __init__(self, ttl_seconds: int = NOW_PLAYING_TTL_SECONDS):
        # keyed by DID
        self._cache: TTLCache[str, NowPlayingState] = TTLCache(
            maxsize=10000, ttl=ttl_seconds
        )

    def update(
        self,
        did: str,
        track_name: str,
        artist_name: str,
        album_name: str | None,
        duration_ms: int,
        progress_ms: int,
        track_id: int,
        file_id: str,
        track_url: str,
        image_url: str | None,
        is_playing: bool,
    ) -> None:
        """update playback state for a user."""
        state = NowPlayingState(
            track_name=track_name,
            artist_name=artist_name,
            album_name=album_name,
            duration_ms=duration_ms,
            progress_ms=progress_ms,
            track_id=track_id,
            file_id=file_id,
            track_url=track_url,
            image_url=image_url,
            is_playing=is_playing,
            updated_at=datetime.now(UTC),
        )
        self._cache[did] = state
        logger.debug(f"updated now playing for {did}: {track_name} by {artist_name}")

    def get(self, did: str) -> NowPlayingState | None:
        """get current playback state for a user."""
        return self._cache.get(did)

    def clear(self, did: str) -> None:
        """clear playback state for a user (stopped playing)."""
        self._cache.pop(did, None)
        logger.debug(f"cleared now playing for {did}")

    def get_active_count(self) -> int:
        """get count of users currently playing (for metrics)."""
        return len(self._cache)


# global instance
now_playing_service = NowPlayingService()

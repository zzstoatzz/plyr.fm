"""Viewer-aware metadata visibility for owner-only and permissioned-Space works.

Owner-only listening hides a track from every other viewer, independently of its
stored discovery setting. Space membership grants access only to Space tracks.
Direct reads use 404; SQL filters remove inaccessible rows before pagination.
"""

import asyncio
import logging

from fastapi import HTTPException
from sqlalchemy import ColumnElement, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.private_access import can_access, held_access
from backend.models import Track

logger = logging.getLogger(__name__)

LISTING_ASK_TIMEOUT_SECONDS = 5.0


async def _has_private_tracks(db: AsyncSession, artist_did: str) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(
                    Track.artist_did == artist_did, Track.visibility == "private"
                )
            )
        )
    )


async def _ask_for_listing(db: AsyncSession, session: Session, artist_did: str) -> bool:
    """ask the authority about one artist on behalf of a listing, bounded so a
    slow host cannot hold the page; a timeout is not remembered."""
    if not await _has_private_tracks(db, artist_did):
        return False
    try:
        return await asyncio.wait_for(
            can_access(session, artist_did), LISTING_ASK_TIMEOUT_SECONDS
        )
    except TimeoutError:
        logger.warning(
            "private access: authority for %s too slow for a listing", artist_did
        )
        return False


async def visible_filter(
    session: Session | None,
    *,
    artist_did: str | None = None,
    db: AsyncSession | None = None,
) -> ColumnElement[bool]:
    """SQL condition: non-private tracks, plus private tracks the viewer owns or
    holds access to. pass ``artist_did`` (with ``db``) to ask the authority for
    that artist first."""
    not_private = Track.publicly_visible.is_(True)
    if session is None:
        return not_private
    accessible = await held_access(session.did)
    if (
        artist_did is not None
        and db is not None
        and artist_did != session.did
        and artist_did not in accessible
        and await _ask_for_listing(db, session, artist_did)
    ):
        accessible.add(artist_did)
    conditions = [not_private, Track.artist_did == session.did]
    if accessible:
        conditions.append(
            Track.is_private & ~Track.is_owner_only & Track.artist_did.in_(accessible)
        )
    return or_(*conditions)


async def can_view_track(session: Session | None, track: Track) -> bool:
    """whether the viewer may see/interact with `track`."""
    if track.is_owner_only:
        return session is not None and session.did == track.artist_did
    if not track.is_private:
        return True
    return await can_access(session, track.artist_did)


async def ensure_track_visible(track: Track, session: Session | None) -> None:
    """404 when a private track is accessed by anyone the authority won't admit.

    404 (not 403) so a private track is indistinguishable from a missing one —
    sequential ids must not let a non-member probe for private uploads.
    """
    if not await can_view_track(session, track):
        raise HTTPException(status_code=404, detail="track not found")

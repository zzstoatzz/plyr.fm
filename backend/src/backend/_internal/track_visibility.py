"""private (permissioned-space) track visibility — one place, applied everywhere.

a private track (`Track.is_private`) lives in the artist's permissioned space and
is visible to its owner and to the DIDs on the artist's private-media member
list, and invisible and inert to everyone else: no metadata reads, no
listing/counting, no likes/comments/shares/embeds. public, unlisted, and gated
tracks are unaffected (unlisted is still searchable/listable by design).

two shapes:
- [track_visible_filter][backend._internal.track_visibility.track_visible_filter]:
  a SQLAlchemy condition for queries that list/count tracks.
- [ensure_track_visible][backend._internal.track_visibility.ensure_track_visible]:
  a guard for endpoints that load one track by id/uri/file_id.
"""

from typing import Protocol, runtime_checkable

from fastapi import HTTPException
from sqlalchemy import ColumnElement, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import PrivateMediaMember, Track


@runtime_checkable
class _HasDid(Protocol):
    """structural type for anything carrying a DID (e.g. an auth Session)."""

    did: str


def _membership(artist_did, viewer_did: str) -> ColumnElement[bool]:
    return exists(
        select(PrivateMediaMember.member_did).where(
            PrivateMediaMember.artist_did == artist_did,
            PrivateMediaMember.member_did == viewer_did,
        )
    )


def track_visible_filter(viewer_did: str | None) -> ColumnElement[bool]:
    """SQL condition: non-private tracks, plus private tracks the viewer owns or
    is a member of."""
    not_private = Track.visibility != "private"
    if viewer_did is None:
        return not_private
    return or_(
        not_private,
        Track.artist_did == viewer_did,
        _membership(Track.artist_did, viewer_did),
    )


async def is_private_media_member(
    db: AsyncSession, artist_did: str, viewer_did: str | None
) -> bool:
    """whether ``viewer_did`` is on ``artist_did``'s private-media member list."""
    if viewer_did is None:
        return False
    return bool(await db.scalar(select(_membership(artist_did, viewer_did))))


async def can_view_track(
    db: AsyncSession, viewer_did: str | None, track: Track
) -> bool:
    """whether `viewer_did` may see/interact with `track`."""
    if not track.is_private or viewer_did == track.artist_did:
        return True
    return await is_private_media_member(db, track.artist_did, viewer_did)


async def ensure_track_visible(
    db: AsyncSession, track: Track, viewer_did: str | None
) -> None:
    """404 when a private track is accessed by anyone but its owner or a member.

    404 (not 403) so a private track is indistinguishable from a missing one —
    sequential ids must not let a non-member probe for private uploads.
    """
    if not await can_view_track(db, viewer_did, track):
        raise HTTPException(status_code=404, detail="track not found")


def viewer_did(session: _HasDid | None) -> str | None:
    """extract the DID from an optional session for the helpers above."""
    return session.did if session is not None else None

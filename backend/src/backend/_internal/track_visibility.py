"""private (permissioned-space) track visibility — one place, applied everywhere.

a private track (`Track.is_private`) lives in the artist's permissioned space and
must be invisible and inert to everyone except its owner: no metadata reads, no
listing/counting, no likes/comments/shares/embeds. public, unlisted, and gated
tracks are unaffected (unlisted is still searchable/listable by design).

two shapes:
- [track_visible_filter][backend._internal.track_visibility.track_visible_filter]:
  a SQLAlchemy condition for queries that list/count tracks.
- [ensure_track_visible][backend._internal.track_visibility.ensure_track_visible]:
  a guard for endpoints that load one track by id/uri/file_id.
"""

from typing import Protocol

from fastapi import HTTPException
from sqlalchemy import ColumnElement, or_

from backend.models import Track


class _HasDid(Protocol):
    """structural type for anything carrying a DID (e.g. an auth Session)."""

    did: str


def track_visible_filter(viewer_did: str | None) -> ColumnElement[bool]:
    """SQL condition: public tracks, plus the viewer's own private tracks."""
    if viewer_did is None:
        return Track.is_private.is_(False)
    return or_(Track.is_private.is_(False), Track.artist_did == viewer_did)


def can_view_track(viewer_did: str | None, track: Track) -> bool:
    """whether `viewer_did` may see/interact with `track` (owner-only when private)."""
    return not track.is_private or viewer_did == track.artist_did


def ensure_track_visible(track: Track, viewer_did: str | None) -> None:
    """404 when a private track is accessed by anyone but its owner.

    404 (not 403) so a private track is indistinguishable from a missing one —
    sequential ids must not let a non-owner probe for private uploads.
    """
    if not can_view_track(viewer_did, track):
        raise HTTPException(status_code=404, detail="track not found")


def viewer_did(session: _HasDid | None) -> str | None:
    """extract the DID from an optional session for the helpers above."""
    return session.did if session is not None else None

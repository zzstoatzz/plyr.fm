"""private (permissioned-space) track visibility — one place, applied everywhere.

a private track (`Track.is_private`) lives in the artist's permissioned space and
is visible to its owner and to anyone the space authority will issue a
credential to ([private_access][backend._internal.private_access]), and
invisible and inert to everyone else: no metadata reads, no listing/counting,
no likes/comments/shares/embeds. public, unlisted, and gated tracks are
unaffected (unlisted is still searchable/listable by design).

two shapes:
- [visible_filter][backend._internal.track_visibility.visible_filter]: a
  SQLAlchemy condition for queries that list/count tracks. it shows the private
  tracks of artists the viewer already holds a credential for; naming an
  ``artist_did`` asks the authority for that one artist first, so an artist's
  own page is answered from the source of truth.
- [ensure_track_visible][backend._internal.track_visibility.ensure_track_visible]:
  a guard for endpoints that load one track by id/uri/file_id. asks the
  authority.
"""

from fastapi import HTTPException
from sqlalchemy import ColumnElement, or_

from backend._internal import Session
from backend._internal.private_access import can_access, held_access
from backend.models import Track


async def visible_filter(
    session: Session | None, *, artist_did: str | None = None
) -> ColumnElement[bool]:
    """SQL condition: non-private tracks, plus private tracks the viewer owns or
    holds access to."""
    not_private = Track.visibility != "private"
    if session is None:
        return not_private
    accessible = await held_access(session.did)
    if (
        artist_did is not None
        and artist_did != session.did
        and artist_did not in accessible
        and await can_access(session, artist_did)
    ):
        accessible.add(artist_did)
    conditions = [not_private, Track.artist_did == session.did]
    if accessible:
        conditions.append(Track.artist_did.in_(accessible))
    return or_(*conditions)


async def can_view_track(session: Session | None, track: Track) -> bool:
    """whether the viewer may see/interact with `track`."""
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

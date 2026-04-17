"""shared track hydration for list-backed endpoints (playlists, liked lists)."""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.models import Track, TrackLike
from backend.schemas import TrackResponse
from backend.utilities.aggregations import (
    get_comment_counts,
    get_like_counts,
    get_top_likers,
)


async def hydrate_tracks_from_uris(
    db: AsyncSession,
    track_uris: list[str],
    session_did: str | None = None,
) -> list[TrackResponse]:
    """load tracks by AT-URI, aggregate counts, and return ordered TrackResponses.

    preserves the order of track_uris (ATProto list record order).
    skips URIs that don't resolve to a track in the database.
    """
    if not track_uris:
        return []

    track_result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.atproto_record_uri.in_(track_uris))
    )
    all_tracks = track_result.scalars().all()
    track_by_uri = {t.atproto_record_uri: t for t in all_tracks}

    track_ids = [t.id for t in all_tracks]
    if track_ids:
        like_counts, comment_counts, top_likers = await asyncio.gather(
            get_like_counts(db, track_ids),
            get_comment_counts(db, track_ids),
            get_top_likers(db, track_ids),
        )
    else:
        like_counts, comment_counts, top_likers = {}, {}, {}

    liked_track_ids: set[int] = set()
    if session_did and track_ids:
        liked_result = await db.execute(
            select(TrackLike.track_id).where(
                TrackLike.user_did == session_did,
                TrackLike.track_id.in_(track_ids),
            )
        )
        liked_track_ids = set(liked_result.scalars().all())

    tracks: list[TrackResponse] = []
    for uri in track_uris:
        if uri in track_by_uri:
            track = track_by_uri[uri]
            track_response = await TrackResponse.from_track(
                track,
                liked_track_ids=liked_track_ids,
                like_counts=like_counts,
                comment_counts=comment_counts,
                top_likers=top_likers,
            )
            tracks.append(track_response)

    return tracks

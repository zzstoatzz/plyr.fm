"""Read-only track listing endpoints."""

import asyncio
from datetime import datetime
from typing import Annotated

import logfire
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session, require_auth
from backend.config import settings
from backend.models import (
    Artist,
    Tag,
    Track,
    TrackLike,
    TrackTag,
    UserPreferences,
    get_db,
)
from backend.schemas import TrackResponse
from backend.utilities.aggregations import (
    get_comment_counts,
    get_copyright_info,
    get_like_counts,
    get_track_tags,
)
from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

from .router import router


class TracksListResponse(BaseModel):
    """Response for paginated track listing."""

    tracks: list[TrackResponse]
    next_cursor: str | None = None
    has_more: bool = False


@router.get("/")
async def list_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    artist_did: str | None = None,
    filter_hidden_tags: bool | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    session: AuthSession | None = Depends(get_optional_session),
) -> TracksListResponse:
    """List tracks with cursor-based pagination.

    Args:
        artist_did: Filter to tracks by this artist only.
        filter_hidden_tags: Whether to exclude tracks with user's hidden tags.
            - None (default): auto-decide based on context (filter on discovery feed,
              don't filter on artist pages)
            - True: always filter hidden tags
            - False: never filter hidden tags
        cursor: ISO timestamp cursor from previous response's next_cursor.
            Pass this to get the next page of results.
        limit: Maximum number of tracks to return (default from settings, max 100).
    """
    # use settings default if not provided, clamp to reasonable bounds
    if limit is None:
        limit = settings.app.default_page_size
    limit = max(1, min(limit, 100))
    from atproto_identity.did.resolver import AsyncDidResolver

    # get authenticated user's liked tracks and preferences
    liked_track_ids: set[int] | None = None
    hidden_tags: list[str] = list(DEFAULT_HIDDEN_TAGS)

    if session:
        liked_result = await db.execute(
            select(TrackLike.track_id).where(TrackLike.user_did == session.did)
        )
        liked_track_ids = set(liked_result.scalars().all())

        # get user's hidden tags preference
        prefs_result = await db.execute(
            select(UserPreferences).where(UserPreferences.did == session.did)
        )
        prefs = prefs_result.scalar_one_or_none()
        if prefs and prefs.hidden_tags is not None:
            hidden_tags = prefs.hidden_tags

    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
    )

    # filter by artist if provided
    if artist_did:
        stmt = stmt.where(Track.artist_did == artist_did)

    # filter out tracks with hidden tags
    # when filter_hidden_tags is None (default), auto-decide:
    # - discovery feed (no artist_did): filter
    # - artist page (has artist_did): don't filter (show all their tracks)
    should_filter = (
        filter_hidden_tags if filter_hidden_tags is not None else (artist_did is None)
    )
    if hidden_tags and should_filter:
        # subquery: track IDs that have any of the hidden tags
        hidden_track_ids_subq = (
            select(TrackTag.track_id)
            .join(Tag, TrackTag.tag_id == Tag.id)
            .where(Tag.name.in_(hidden_tags))
            .distinct()
            .scalar_subquery()
        )
        stmt = stmt.where(Track.id.not_in(hidden_track_ids_subq))

    # apply cursor-based pagination (tracks older than cursor timestamp)
    if cursor:
        try:
            cursor_time = datetime.fromisoformat(cursor)
            stmt = stmt.where(Track.created_at < cursor_time)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid cursor format") from e

    # order by created_at desc and fetch one extra to check if there's more
    stmt = stmt.order_by(Track.created_at.desc()).limit(limit + 1)
    result = await db.execute(stmt)
    tracks = list(result.scalars().all())

    # check if there are more results and trim to requested limit
    if has_more := len(tracks) > limit:
        tracks = tracks[:limit]

    # generate next cursor from the last track's created_at
    next_cursor = tracks[-1].created_at.isoformat() if has_more and tracks else None

    # batch fetch like counts, comment counts, and tags for all tracks
    # note: copyright_info is intentionally excluded here - it requires an HTTP call
    # to the moderation service and is only displayed in /tracks/me (artist portal)
    track_ids = [track.id for track in tracks]
    like_counts, comment_counts, track_tags = await asyncio.gather(
        get_like_counts(db, track_ids),
        get_comment_counts(db, track_ids),
        get_track_tags(db, track_ids),
    )

    # use cached PDS URLs with fallback on failure
    resolver = AsyncDidResolver()
    pds_cache = {}

    # first pass: collect already-cached PDS URLs and artists needing resolution
    artists_to_resolve = {}  # dict for O(1) deduplication by DID
    for track in tracks:
        if track.artist_did not in pds_cache:
            if track.artist.pds_url:
                pds_cache[track.artist_did] = track.artist.pds_url
            else:
                # need to resolve this artist
                if track.artist_did not in artists_to_resolve:
                    artists_to_resolve[track.artist_did] = track.artist

    # resolve all uncached PDS URLs concurrently
    if artists_to_resolve:
        with logfire.span(
            "resolve PDS URLs",
            artist_count=len(artists_to_resolve),
            _level="debug",
        ):

            async def resolve_artist(artist: Artist) -> tuple[str, str | None]:
                """Resolve PDS URL for an artist, returning (did, pds_url)."""
                with logfire.span("resolve single PDS", did=artist.did, _level="debug"):
                    try:
                        atproto_data = await resolver.resolve_atproto_data(artist.did)
                        return (artist.did, atproto_data.pds)
                    except Exception as e:
                        logfire.warn(
                            f"failed to resolve PDS for {artist.did}", error=str(e)
                        )
                        return (artist.did, None)

            # resolve all concurrently
            results = await asyncio.gather(
                *[resolve_artist(a) for a in artists_to_resolve.values()]
            )

        # update cache and database with O(1) lookups
        for did, pds_url in results:
            pds_cache[did] = pds_url
            if pds_url:
                artist = artists_to_resolve.get(did)
                if artist:
                    artist.pds_url = pds_url
                    db.add(artist)

    # commit any PDS URL updates
    await db.commit()

    # resolve missing image URLs and self-heal invalid image_ids
    # this prevents repeated R2 404 checks ("ghost reads") for missing files
    tracks_needing_images = [t for t in tracks if t.image_id and not t.image_url]
    if tracks_needing_images:
        with logfire.span(
            "resolve missing images", count=len(tracks_needing_images), _level="debug"
        ):

            async def resolve_image(track: Track) -> None:
                """Resolve image URL and update track state."""
                try:
                    url = await track.get_image_url()
                    if url:
                        track.image_url = url
                    else:
                        # image_id exists but file not found in R2
                        # log error but don't clear - this indicates a bug (e.g. extension mismatch)
                        # clearing would destroy the reference and make debugging harder
                        logfire.error(
                            "image_id exists but file not found in R2",
                            track_id=track.id,
                            image_id=track.image_id,
                        )
                except Exception as e:
                    logfire.error(
                        "failed to resolve image",
                        track_id=track.id,
                        image_id=track.image_id,
                        error=str(e),
                    )

            await asyncio.gather(*[resolve_image(t) for t in tracks_needing_images])
            await db.commit()

    # fetch all track responses concurrently with like status and counts
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track,
                pds_cache.get(track.artist_did),
                liked_track_ids,
                like_counts,
                comment_counts,
                track_tags=track_tags,
            )
            for track in tracks
        ]
    )

    return TracksListResponse(
        tracks=list(track_responses),
        next_cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/me")
async def list_my_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """List tracks uploaded by authenticated user."""
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.artist_did == auth_session.did)
        .order_by(Track.created_at.desc())
    )
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # batch fetch copyright info and tags
    track_ids = [track.id for track in tracks]
    copyright_info, track_tags = await asyncio.gather(
        get_copyright_info(db, track_ids),
        get_track_tags(db, track_ids),
    )

    # fetch all track responses concurrently
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, copyright_info=copyright_info, track_tags=track_tags
            )
            for track in tracks
        ]
    )

    return {"tracks": track_responses}


class BrokenTracksResponse(BaseModel):
    """Response for broken tracks endpoint."""

    tracks: list[TrackResponse]
    count: int


@router.get("/me/broken")
async def list_broken_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> BrokenTracksResponse:
    """Return tracks owned by the user that have missing ATProto records.

    These are tracks with a null `atproto_record_uri`, meaning they need
    recovery. Such tracks cannot be liked and may require migration or
    recreation.
    """
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.artist_did == auth_session.did)
        .where((Track.atproto_record_uri.is_(None)) | (Track.atproto_record_uri == ""))
        .order_by(Track.created_at.desc())
    )
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # batch fetch copyright info and tags
    track_ids = [track.id for track in tracks]
    copyright_info, track_tags = await asyncio.gather(
        get_copyright_info(db, track_ids),
        get_track_tags(db, track_ids),
    )

    # fetch all track responses concurrently
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, copyright_info=copyright_info, track_tags=track_tags
            )
            for track in tracks
        ]
    )

    return BrokenTracksResponse(tracks=track_responses, count=len(track_responses))

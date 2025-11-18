"""Read-only track listing endpoints."""

import asyncio
from typing import Annotated

import logfire
from fastapi import Cookie, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.auth import get_session
from backend.models import Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import get_like_counts

from .router import router


@router.get("/")
async def list_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    artist_did: str | None = None,
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> dict:
    """List all tracks, optionally filtered by artist DID."""
    from atproto_identity.did.resolver import AsyncDidResolver

    # get authenticated user if cookie or auth header present
    liked_track_ids: set[int] | None = None
    session_id = session_id_cookie or request.headers.get("authorization", "").replace(
        "Bearer ", ""
    )
    if session_id and (auth_session := await get_session(session_id)):
        liked_result = await db.execute(
            select(TrackLike.track_id).where(TrackLike.user_did == auth_session.did)
        )
        liked_track_ids = set(liked_result.scalars().all())

    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
    )

    # filter by artist if provided
    if artist_did:
        stmt = stmt.where(Track.artist_did == artist_did)

    stmt = stmt.order_by(Track.created_at.desc())
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # batch fetch like counts for all tracks
    track_ids = [track.id for track in tracks]
    like_counts = await get_like_counts(db, track_ids)

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

    # fetch all track responses concurrently with like status and counts
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, pds_cache.get(track.artist_did), liked_track_ids, like_counts
            )
            for track in tracks
        ]
    )

    return {"tracks": track_responses}


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

    # fetch all track responses concurrently
    track_responses = await asyncio.gather(
        *[TrackResponse.from_track(track) for track in tracks]
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

    # fetch all track responses concurrently
    track_responses = await asyncio.gather(
        *[TrackResponse.from_track(track) for track in tracks]
    )

    return BrokenTracksResponse(tracks=track_responses, count=len(track_responses))

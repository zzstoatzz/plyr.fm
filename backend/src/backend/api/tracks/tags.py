"""tag endpoints for track categorization."""

import asyncio
import logging
from collections import defaultdict
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import tpuf_client
from backend._internal.auth import get_session
from backend.config import settings
from backend.models import Artist, Tag, Track, TrackLike, TrackTag, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import (
    get_comment_counts,
    get_like_counts,
    get_track_tags,
)

from .router import router

logger = logging.getLogger(__name__)


class TagWithCount(BaseModel):
    """tag with track count for autocomplete."""

    name: str
    track_count: int


class TagDetail(BaseModel):
    """tag detail with metadata."""

    name: str
    track_count: int


class TagTracksResponse(BaseModel):
    """response for getting tracks by tag."""

    tag: TagDetail
    tracks: list[TrackResponse]
    created_by_handle: str | None = None


@router.get("/tags/{tag_name}")
async def get_tracks_by_tag(
    tag_name: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> TagTracksResponse:
    """get all tracks with a specific tag.

    returns tag info and list of tracks tagged with that tag.
    """
    # normalize tag name (lowercase)
    tag_name = tag_name.strip().lower()

    # find the tag
    tag_result = await db.execute(
        select(Tag).options(selectinload(Tag.creator)).where(Tag.name == tag_name)
    )
    tag = tag_result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail=f"tag '{tag_name}' not found")

    # get tracks with this tag
    stmt = (
        select(Track)
        .join(Artist, Track.artist_did == Artist.did)
        .join(TrackTag, Track.id == TrackTag.track_id)
        .where(TrackTag.tag_id == tag.id)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .order_by(Track.created_at.desc())
    )
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # get authenticated user's liked tracks if logged in
    liked_track_ids: set[int] | None = None
    session_id = session_id_cookie or request.headers.get("authorization", "").replace(
        "Bearer ", ""
    )
    if session_id and (auth_session := await get_session(session_id)):
        liked_result = await db.execute(
            select(TrackLike.track_id).where(TrackLike.user_did == auth_session.did)
        )
        liked_track_ids = set(liked_result.scalars().all())

    # batch fetch like counts, comment counts, and tags
    # note: copyright_info excluded - only needed in artist portal (/tracks/me)
    track_ids = [track.id for track in tracks]
    like_counts, comment_counts, track_tags_map = await asyncio.gather(
        get_like_counts(db, track_ids),
        get_comment_counts(db, track_ids),
        get_track_tags(db, track_ids),
    )

    # build track responses
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track,
                liked_track_ids=liked_track_ids,
                like_counts=like_counts,
                comment_counts=comment_counts,
                track_tags=track_tags_map,
            )
            for track in tracks
        ]
    )

    return TagTracksResponse(
        tag=TagDetail(
            name=tag.name,
            track_count=len(tracks),
            created_by_handle=tag.creator.handle if tag.creator else None,
        ),
        tracks=track_responses,
    )


@router.get("/tags")
async def list_tags(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str | None, Query(description="search query for tag names")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[TagWithCount]:
    """list tags with track counts, optionally filtered by query.

    returns tags sorted by track count (most used first).
    use `q` parameter for prefix search (case-insensitive).
    """
    # build query: tags with their track counts
    query = (
        select(Tag.name, func.count(TrackTag.track_id).label("track_count"))
        .outerjoin(TrackTag, Tag.id == TrackTag.tag_id)
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(TrackTag.track_id).desc(), Tag.name)
        .limit(limit)
    )

    # apply prefix filter if query provided
    if q:
        query = query.where(Tag.name.ilike(f"{q}%"))

    result = await db.execute(query)
    rows = result.all()

    return [TagWithCount(name=row.name, track_count=row.track_count) for row in rows]


class RecommendedTag(BaseModel):
    """a recommended tag with similarity-weighted score."""

    name: str
    score: float


class RecommendedTagsResponse(BaseModel):
    """response for tag recommendations based on audio similarity."""

    track_id: int
    tags: list[RecommendedTag]
    available: bool = True


@router.get("/{track_id}/recommended-tags")
async def get_recommended_tags(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
) -> RecommendedTagsResponse:
    """recommend tags for a track based on similar-sounding tracks.

    uses CLAP audio embeddings to find similar tracks, then aggregates
    their tags weighted by similarity score.
    """
    # verify track exists
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()
    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # check if embeddings are enabled
    if not (settings.modal.enabled and settings.turbopuffer.enabled):
        return RecommendedTagsResponse(track_id=track_id, tags=[], available=False)

    # fetch this track's embedding
    embedding = await tpuf_client.get_vector(track_id)
    if embedding is None:
        return RecommendedTagsResponse(track_id=track_id, tags=[])

    # find similar tracks
    similar = await tpuf_client.query(embedding, top_k=21)

    # filter out self
    neighbors = [r for r in similar if r.track_id != track_id][:20]
    if not neighbors:
        return RecommendedTagsResponse(track_id=track_id, tags=[])

    neighbor_ids = [r.track_id for r in neighbors]
    similarity_by_id = {r.track_id: 1.0 - r.distance for r in neighbors}

    # fetch tags for neighbors and the target track
    all_ids = [*neighbor_ids, track_id]
    tags_map = await get_track_tags(db, all_ids)

    current_tags = tags_map.get(track_id, set())

    # aggregate: sum similarity scores per tag across neighbors
    tag_scores: dict[str, float] = defaultdict(float)
    for neighbor_id in neighbor_ids:
        sim = similarity_by_id[neighbor_id]
        for tag_name in tags_map.get(neighbor_id, set()):
            if tag_name not in current_tags:
                tag_scores[tag_name] += sim

    if not tag_scores:
        return RecommendedTagsResponse(track_id=track_id, tags=[])

    # normalize to 0-1
    max_score = max(tag_scores.values())
    recommended = sorted(tag_scores.items(), key=lambda x: x[1], reverse=True)[:limit]

    return RecommendedTagsResponse(
        track_id=track_id,
        tags=[
            RecommendedTag(name=name, score=round(score / max_score, 3))
            for name, score in recommended
        ],
    )

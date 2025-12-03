"""search endpoints for relay."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.handles import search_handles
from backend.models import Album, Artist, Tag, Track, TrackTag, get_db

router = APIRouter(prefix="/search", tags=["search"])


# response models
class TrackSearchResult(BaseModel):
    """track search result."""

    type: Literal["track"] = "track"
    id: int
    title: str
    artist_handle: str
    artist_display_name: str
    image_url: str | None
    relevance: float


class ArtistSearchResult(BaseModel):
    """artist search result."""

    type: Literal["artist"] = "artist"
    did: str
    handle: str
    display_name: str
    avatar_url: str | None
    relevance: float


class AlbumSearchResult(BaseModel):
    """album search result."""

    type: Literal["album"] = "album"
    id: str
    title: str
    slug: str
    artist_handle: str
    artist_display_name: str
    image_url: str | None
    relevance: float


class TagSearchResult(BaseModel):
    """tag search result."""

    type: Literal["tag"] = "tag"
    id: int
    name: str
    track_count: int
    relevance: float


SearchResult = (
    TrackSearchResult | ArtistSearchResult | AlbumSearchResult | TagSearchResult
)


class SearchResponse(BaseModel):
    """unified search response."""

    results: list[SearchResult]
    counts: dict[str, int]


@router.get("/handles")
async def search_atproto_handles(
    q: str = Query(..., min_length=2, description="search query (handle prefix)"),
    limit: int = Query(10, ge=1, le=25, description="max results"),
) -> dict:
    """search for ATProto handles by prefix.

    returns list of {did, handle, display_name, avatar_url}
    """
    results = await search_handles(q, limit=limit)
    return {"results": results}


@router.get("/")
async def unified_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str = Query(..., min_length=2, max_length=100, description="search query"),
    type: str | None = Query(
        None,
        description="filter by type: tracks, artists, albums, tags (comma-separated for multiple)",
    ),
    limit: int = Query(20, ge=1, le=50, description="max results per type"),
) -> SearchResponse:
    """unified search across tracks, artists, albums, and tags.

    uses pg_trgm for fuzzy matching with similarity scoring.
    results are sorted by relevance within each type.
    """
    # parse types filter
    if type:
        types = {t.strip().lower() for t in type.split(",")}
    else:
        types = {"tracks", "artists", "albums", "tags"}

    results: list[SearchResult] = []
    counts: dict[str, int] = {"tracks": 0, "artists": 0, "albums": 0, "tags": 0}

    # search tracks
    if "tracks" in types:
        track_results = await _search_tracks(db, q, limit)
        results.extend(track_results)
        counts["tracks"] = len(track_results)

    # search artists
    if "artists" in types:
        artist_results = await _search_artists(db, q, limit)
        results.extend(artist_results)
        counts["artists"] = len(artist_results)

    # search albums
    if "albums" in types:
        album_results = await _search_albums(db, q, limit)
        results.extend(album_results)
        counts["albums"] = len(album_results)

    # search tags
    if "tags" in types:
        tag_results = await _search_tags(db, q, limit)
        results.extend(tag_results)
        counts["tags"] = len(tag_results)

    # sort all results by relevance (highest first)
    results.sort(key=lambda x: x.relevance, reverse=True)

    return SearchResponse(results=results, counts=counts)


async def _search_tracks(
    db: AsyncSession, query: str, limit: int
) -> list[TrackSearchResult]:
    """search tracks by title using trigram similarity + substring matching."""
    # use pg_trgm similarity function for fuzzy matching
    similarity = func.similarity(Track.title, query)
    # also match substrings (e.g. "real" in "really")
    substring_match = Track.title.ilike(f"%{query}%")

    stmt = (
        select(Track, Artist, similarity.label("relevance"))
        .join(Artist, Track.artist_did == Artist.did)
        .where(or_(similarity > 0.1, substring_match))
        .order_by(similarity.desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        TrackSearchResult(
            id=track.id,
            title=track.title,
            artist_handle=artist.handle,
            artist_display_name=artist.display_name,
            image_url=track.image_url,
            relevance=round(relevance, 3),
        )
        for track, artist, relevance in rows
    ]


async def _search_artists(
    db: AsyncSession, query: str, limit: int
) -> list[ArtistSearchResult]:
    """search artists by handle and display_name using trigram similarity + substring."""
    # combine similarity scores from handle and display_name (take max)
    handle_sim = func.similarity(Artist.handle, query)
    name_sim = func.similarity(Artist.display_name, query)
    combined_sim = func.greatest(handle_sim, name_sim)
    # also match substrings
    substring_match = or_(
        Artist.handle.ilike(f"%{query}%"),
        Artist.display_name.ilike(f"%{query}%"),
    )

    stmt = (
        select(Artist, combined_sim.label("relevance"))
        .where(or_(combined_sim > 0.1, substring_match))
        .order_by(combined_sim.desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        ArtistSearchResult(
            did=artist.did,
            handle=artist.handle,
            display_name=artist.display_name,
            avatar_url=artist.avatar_url,
            relevance=round(relevance, 3),
        )
        for artist, relevance in rows
    ]


async def _search_albums(
    db: AsyncSession, query: str, limit: int
) -> list[AlbumSearchResult]:
    """search albums by title using trigram similarity + substring."""
    similarity = func.similarity(Album.title, query)
    substring_match = Album.title.ilike(f"%{query}%")

    stmt = (
        select(Album, Artist, similarity.label("relevance"))
        .join(Artist, Album.artist_did == Artist.did)
        .where(or_(similarity > 0.1, substring_match))
        .order_by(similarity.desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        AlbumSearchResult(
            id=album.id,
            title=album.title,
            slug=album.slug,
            artist_handle=artist.handle,
            artist_display_name=artist.display_name,
            image_url=album.image_url,
            relevance=round(relevance, 3),
        )
        for album, artist, relevance in rows
    ]


async def _search_tags(
    db: AsyncSession, query: str, limit: int
) -> list[TagSearchResult]:
    """search tags by name using trigram similarity + substring."""
    similarity = func.similarity(Tag.name, query)
    substring_match = Tag.name.ilike(f"%{query}%")

    # count tracks per tag
    track_count_subq = (
        select(TrackTag.tag_id, func.count(TrackTag.track_id).label("track_count"))
        .group_by(TrackTag.tag_id)
        .subquery()
    )

    stmt = (
        select(
            Tag,
            func.coalesce(track_count_subq.c.track_count, 0).label("track_count"),
            similarity.label("relevance"),
        )
        .outerjoin(track_count_subq, Tag.id == track_count_subq.c.tag_id)
        .where(or_(similarity > 0.1, substring_match))
        .order_by(similarity.desc())
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    return [
        TagSearchResult(
            id=tag.id,
            name=tag.name,
            track_count=track_count,
            relevance=round(relevance, 3),
        )
        for tag, track_count, relevance in rows
    ]

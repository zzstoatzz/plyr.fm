"""XRPC endpoints for cross-app interop.

implements parts.page.mention.search for Leaflet embed integration.
"""

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.search import (
    AlbumSearchResult,
    ArtistSearchResult,
    PlaylistSearchResult,
    SearchResult,
    TagSearchResult,
    TrackSearchResult,
    _search_albums,
    _search_artists,
    _search_playlists,
    _search_tags,
    _search_tracks,
)
from backend.config import settings
from backend.models import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/xrpc", tags=["xrpc"])

# scope → search type mapping
SCOPE_MAP: dict[str, str] = {
    "tracks": "tracks",
    "artists": "artists",
    "albums": "albums",
    "playlists": "playlists",
    "tags": "tags",
}

ALL_TYPES = set(SCOPE_MAP.values())


def _result_to_mention(result: SearchResult) -> dict[str, Any]:
    """convert an internal search result to a parts.page.mention.search result."""
    base_url = settings.frontend.url

    match result:
        case TrackSearchResult():
            mention: dict[str, Any] = {
                "uri": f"{base_url}/track/{result.id}",
                "name": result.title,
                "description": f"by {result.artist_display_name}",
                "href": f"{base_url}/track/{result.id}",
                "labels": [{"text": "track"}],
                "embed": {
                    "src": f"{base_url}/embed/track/{result.id}",
                    "aspectRatio": {"width": 16, "height": 9},
                },
                "subscope": {"scope": "tracks", "label": "Tracks"},
            }
            if result.image_url:
                mention["icon"] = result.image_url
            return mention

        case ArtistSearchResult():
            mention = {
                "uri": f"{base_url}/u/{result.handle}",
                "name": result.display_name,
                "description": f"@{result.handle}",
                "href": f"{base_url}/u/{result.handle}",
                "labels": [{"text": "artist"}],
                "subscope": {"scope": "artists", "label": "Artists"},
            }
            if result.avatar_url:
                mention["icon"] = result.avatar_url
            return mention

        case AlbumSearchResult():
            mention = {
                "uri": f"{base_url}/u/{result.artist_handle}/album/{result.slug}",
                "name": result.title,
                "description": f"by {result.artist_display_name}",
                "href": f"{base_url}/u/{result.artist_handle}/album/{result.slug}",
                "labels": [{"text": "album"}],
                "embed": {
                    "src": f"{base_url}/embed/album/{result.artist_handle}/{result.slug}",
                    "aspectRatio": {"width": 16, "height": 9},
                },
                "subscope": {"scope": "albums", "label": "Albums"},
            }
            if result.image_url:
                mention["icon"] = result.image_url
            return mention

        case PlaylistSearchResult():
            mention = {
                "uri": f"{base_url}/playlist/{result.id}",
                "name": result.name,
                "description": f"by {result.owner_display_name} · {result.track_count} tracks",
                "href": f"{base_url}/playlist/{result.id}",
                "labels": [{"text": "playlist"}],
                "embed": {
                    "src": f"{base_url}/embed/playlist/{result.id}",
                    "aspectRatio": {"width": 16, "height": 9},
                },
                "subscope": {"scope": "playlists", "label": "Playlists"},
            }
            if result.image_url:
                mention["icon"] = result.image_url
            return mention

        case TagSearchResult():
            return {
                "uri": f"{base_url}/tag/{result.name}",
                "name": result.name,
                "description": f"{result.track_count} tracks",
                "href": f"{base_url}/tag/{result.name}",
                "labels": [{"text": "tag"}],
                "subscope": {"scope": "tags", "label": "Tags"},
            }


@router.get("/parts.page.mention.search")
async def mention_search(
    db: Annotated[AsyncSession, Depends(get_db)],
    service: str = Query(..., description="AT URI of the mention service record"),
    search: str = Query(..., min_length=1, max_length=100, description="search query"),
    scope: str | None = Query(None, description="scope to narrow results"),
    limit: int = Query(20, ge=1, le=50, description="max results"),
) -> dict[str, Any]:
    """XRPC query: parts.page.mention.search

    search plyr.fm tracks, artists, albums, playlists, and tags.
    returns results formatted per the parts.page.mention.search lexicon
    with embed info for Leaflet iframe integration.
    """
    if len(search) < 2:
        return {"results": []}

    types = {SCOPE_MAP[scope]} if scope and scope in SCOPE_MAP else ALL_TYPES

    results: list[SearchResult] = []

    if "tracks" in types:
        results.extend(await _search_tracks(db, search, limit))
    if "artists" in types:
        results.extend(await _search_artists(db, search, limit))
    if "albums" in types:
        results.extend(await _search_albums(db, search, limit))
    if "playlists" in types:
        results.extend(await _search_playlists(db, search, limit))
    if "tags" in types:
        results.extend(await _search_tags(db, search, limit))

    results.sort(key=lambda r: r.relevance, reverse=True)
    results = results[:limit]

    return {"results": [_result_to_mention(r) for r in results]}

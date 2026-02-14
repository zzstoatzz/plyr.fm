"""oEmbed endpoint for track, playlist, and album embeds.

Enables services like Leaflet.pub (via iframely) to discover
and use our embed player instead of raw HTML5 audio.
"""

import re
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing_extensions import TypedDict

from backend.config import settings
from backend.models import Album, Artist, Playlist, Track, get_db

router = APIRouter(tags=["oembed"])

TRACK_URL_PATTERN = re.compile(r"/track/(\d+)")
PLAYLIST_URL_PATTERN = re.compile(r"/playlist/([a-f0-9-]+)")
ALBUM_URL_PATTERN = re.compile(r"/u/([^/]+)/album/([^/?#]+)")


class OEmbedResponse(BaseModel):
    """oEmbed response for embeds."""

    version: str = "1.0"
    type: str = "rich"
    provider_name: str = "plyr.fm"
    provider_url: str = "https://plyr.fm"
    title: str
    author_name: str
    author_url: str
    width: int = 400
    height: int = 165
    html: str
    thumbnail_url: str | None = None
    thumbnail_width: int | None = None
    thumbnail_height: int | None = None


class _ThumbnailFields(TypedDict, total=False):
    thumbnail_url: str
    thumbnail_width: int
    thumbnail_height: int


def _build_iframe_html(embed_url: str, width: int, height: int) -> str:
    return (
        f'<iframe src="{embed_url}" '
        f'width="{width}" height="{height}" '
        f'frameborder="0" allow="autoplay" '
        f'style="border-radius: 8px;"></iframe>'
    )


def _thumbnail_fields(image_url: str | None) -> _ThumbnailFields:
    """return thumbnail kwargs for OEmbedResponse if an image exists."""
    if not image_url:
        return {}
    return {
        "thumbnail_url": image_url,
        "thumbnail_width": 300,
        "thumbnail_height": 300,
    }


async def _build_track_oembed(
    track_id: int,
    db: AsyncSession,
    maxwidth: int | None,
    maxheight: int | None,
) -> OEmbedResponse:
    result = await db.execute(
        select(Track).options(selectinload(Track.artist)).where(Track.id == track_id)
    )
    if not (track := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="track not found")

    return OEmbedResponse(
        title=f"{track.title} - {track.artist.display_name}",
        author_name=track.artist.display_name,
        author_url=f"{settings.frontend.url}/u/{track.artist.handle}",
        width=(w := min(maxwidth or 400, 800)),
        height=(h := min(maxheight or 165, 165)),
        html=_build_iframe_html(
            f"{settings.frontend.url}/embed/track/{track_id}", w, h
        ),
        **_thumbnail_fields(track.image_url),
    )


async def _build_playlist_oembed(
    playlist_id: str,
    db: AsyncSession,
    maxwidth: int | None,
    maxheight: int | None,
) -> OEmbedResponse:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.owner))
        .where(Playlist.id == playlist_id)
    )
    if not (playlist := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="playlist not found")

    return OEmbedResponse(
        title=f'"{playlist.name}" by {playlist.owner.display_name}',
        author_name=playlist.owner.display_name,
        author_url=f"{settings.frontend.url}/u/{playlist.owner.handle}",
        width=(w := min(maxwidth or 400, 800)),
        height=(h := min(maxheight or 380, 600)),
        html=_build_iframe_html(
            f"{settings.frontend.url}/embed/playlist/{playlist_id}", w, h
        ),
        **_thumbnail_fields(playlist.image_url),
    )


async def _build_album_oembed(
    handle: str,
    slug: str,
    db: AsyncSession,
    maxwidth: int | None,
    maxheight: int | None,
) -> OEmbedResponse:
    result = await db.execute(
        select(Album)
        .join(Artist, Album.artist_did == Artist.did)
        .options(selectinload(Album.artist))
        .where(Artist.handle == handle, Album.slug == slug)
    )
    if not (album := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="album not found")

    return OEmbedResponse(
        title=f'"{album.title}" by {album.artist.display_name}',
        author_name=album.artist.display_name,
        author_url=f"{settings.frontend.url}/u/{album.artist.handle}",
        width=(w := min(maxwidth or 400, 800)),
        height=(h := min(maxheight or 380, 600)),
        html=_build_iframe_html(
            f"{settings.frontend.url}/embed/album/{handle}/{slug}", w, h
        ),
        **_thumbnail_fields(album.image_url),
    )


@router.get("/oembed")
async def get_oembed(
    url: Annotated[str, Query(description="URL to get oEmbed data for")],
    db: Annotated[AsyncSession, Depends(get_db)],
    maxwidth: Annotated[int | None, Query()] = None,
    maxheight: Annotated[int | None, Query()] = None,
    format: Annotated[str, Query()] = "json",
) -> OEmbedResponse:
    """Return oEmbed data for a track, playlist, or album URL.

    This enables services like iframely to discover our embed player.
    """
    if format != "json":
        raise HTTPException(status_code=501, detail="only json format is supported")

    decoded_url = unquote(url)

    if url_match := TRACK_URL_PATTERN.search(decoded_url):
        return await _build_track_oembed(
            int(url_match.group(1)), db, maxwidth, maxheight
        )

    if url_match := PLAYLIST_URL_PATTERN.search(decoded_url):
        return await _build_playlist_oembed(url_match.group(1), db, maxwidth, maxheight)

    if url_match := ALBUM_URL_PATTERN.search(decoded_url):
        return await _build_album_oembed(
            url_match.group(1), url_match.group(2), db, maxwidth, maxheight
        )

    raise HTTPException(status_code=404, detail="unsupported URL format")

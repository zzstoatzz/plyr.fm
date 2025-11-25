"""oEmbed endpoint for track embeds.

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

from backend.config import settings
from backend.models import Track, get_db

router = APIRouter(tags=["oembed"])

# match /track/{id} or /track/{id}/ or /track/{id}?...
TRACK_URL_PATTERN = re.compile(r"/track/(\d+)")


class OEmbedResponse(BaseModel):
    """oEmbed response for track embeds."""

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


@router.get("/oembed")
async def get_oembed(
    url: Annotated[str, Query(description="URL to get oEmbed data for")],
    db: Annotated[AsyncSession, Depends(get_db)],
    maxwidth: Annotated[int | None, Query()] = None,
    maxheight: Annotated[int | None, Query()] = None,
    format: Annotated[str, Query()] = "json",
) -> OEmbedResponse:
    """Return oEmbed data for a track URL.

    This enables services like iframely to discover our embed player.
    """
    if format != "json":
        raise HTTPException(status_code=501, detail="only json format is supported")

    # decode URL in case it's URL-encoded
    decoded_url = unquote(url)

    # extract track ID from URL
    match = TRACK_URL_PATTERN.search(decoded_url)
    if not match:
        raise HTTPException(status_code=404, detail="invalid track URL")

    track_id = int(match.group(1))

    # fetch track from database
    result = await db.execute(
        select(Track).options(selectinload(Track.artist)).where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # determine frontend URL (use production in prod, localhost in dev)
    frontend_url = settings.frontend.url

    # build embed iframe HTML
    embed_url = f"{frontend_url}/embed/track/{track_id}"
    width = min(maxwidth or 400, 800)
    height = min(maxheight or 165, 165)

    html = (
        f'<iframe src="{embed_url}" '
        f'width="{width}" height="{height}" '
        f'frameborder="0" allow="autoplay" '
        f'style="border-radius: 8px;"></iframe>'
    )

    response = OEmbedResponse(
        title=f"{track.title} - {track.artist.display_name}",
        author_name=track.artist.display_name,
        author_url=f"{frontend_url}/u/{track.artist.handle}",
        width=width,
        height=height,
        html=html,
    )

    # add thumbnail if track has cover art
    if track.image_url:
        response.thumbnail_url = track.image_url
        response.thumbnail_width = 300
        response.thumbnail_height = 300

    return response

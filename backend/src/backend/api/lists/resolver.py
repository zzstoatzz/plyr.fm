"""generic list resolver endpoint."""

from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Album, Artist, Playlist, get_db

from .router import router

# --- generic list resolver ---


class ListByUriResponse(BaseModel):
    """resolved list type and routing info for an AT-URI."""

    type: Literal["album", "playlist"]
    id: str
    handle: str | None = None
    slug: str | None = None


@router.get("/by-uri", response_model=ListByUriResponse)
async def resolve_list_by_uri(
    uri: Annotated[str, Query(description="AT-URI of a list record")],
    db: AsyncSession = Depends(get_db),
) -> ListByUriResponse:
    """resolve a list AT-URI to its type (album or playlist) with routing info."""
    # check albums first
    result = await db.execute(
        select(Album, Artist)
        .join(Artist, Album.artist_did == Artist.did)
        .where(Album.atproto_record_uri == uri)
    )
    if row := result.first():
        album, artist = row
        return ListByUriResponse(
            type="album", id=album.id, handle=artist.handle, slug=album.slug
        )

    # check playlists
    result = await db.execute(
        select(Playlist).where(Playlist.atproto_record_uri == uri)
    )
    if playlist := result.scalar_one_or_none():
        return ListByUriResponse(type="playlist", id=playlist.id)

    raise HTTPException(status_code=404, detail="list not found")

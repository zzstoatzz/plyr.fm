"""shared helpers for track routes."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Album, Artist
from backend.utilities.slugs import slugify


async def get_or_create_album(
    db: AsyncSession,
    artist: Artist,
    title: str,
    image_id: str | None,
    image_url: str | None,
) -> Album:
    """Fetch or create an album for an artist."""
    slug = slugify(title)
    result = await db.execute(
        select(Album).where(Album.artist_did == artist.did, Album.slug == slug)
    )
    album = result.scalar_one_or_none()
    if album:
        return album

    album = Album(
        artist_did=artist.did,
        slug=slug,
        title=title,
        description=None,
        image_id=image_id,
        image_url=image_url,
    )
    db.add(album)
    try:
        await db.flush()
        return album
    except IntegrityError:
        # another request created this album concurrently
        await db.rollback()
        result = await db.execute(
            select(Album).where(Album.artist_did == artist.did, Album.slug == slug)
        )
        album = result.scalar_one_or_none()
        if not album:
            raise
        return album


__all__ = ["get_or_create_album"]

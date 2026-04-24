"""shared helpers for track routes."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Album, Artist
from backend.utilities.slugs import slugify


async def get_or_create_album(
    db: AsyncSession,
    artist: Artist,
    title: str,
    image_id: str | None,
    image_url: str | None,
) -> tuple[Album, bool]:
    """Fetch or create an album for an artist.

    Returns (album, created) where created is True if a new album was made.

    Uses INSERT ... ON CONFLICT DO NOTHING RETURNING so a race between
    concurrent uploads to the same (artist_did, slug) does not have to
    rollback a shared session. The old SELECT-then-INSERT-then-catch pattern
    left the caller's AsyncSession in a fragile state under concurrent load
    and caused pool-level MissingGreenlet errors mid-upload.
    """
    slug = slugify(title)
    stmt = (
        pg_insert(Album)
        .values(
            artist_did=artist.did,
            slug=slug,
            title=title,
            description=None,
            image_id=image_id,
            image_url=image_url,
        )
        .on_conflict_do_nothing(index_elements=["artist_did", "slug"])
        .returning(Album)
    )
    result = await db.execute(stmt)
    if album := result.scalar_one_or_none():
        return album, True

    # conflict — a concurrent task won the race. fetch the existing row.
    existing = await db.execute(
        select(Album).where(Album.artist_did == artist.did, Album.slug == slug)
    )
    return existing.scalar_one(), False


__all__ = ["get_or_create_album"]

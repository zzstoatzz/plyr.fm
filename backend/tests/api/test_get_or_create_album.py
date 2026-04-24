"""regression test for concurrent album creation race.

history: the old SELECT-then-INSERT-then-catch-IntegrityError pattern in
get_or_create_album left the caller's AsyncSession in a fragile state when
multiple concurrent uploads raced to create the same (artist_did, slug) album.
under load this surfaced as pool-level MissingGreenlet errors mid-upload (2 of
12 concurrent uploads to the same album title failed on stg, 2026-04-24).

the replacement uses INSERT ... ON CONFLICT DO NOTHING RETURNING so the race
is resolved at the DB level — no rollback, no session state churn.
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.api.tracks.services import get_or_create_album
from backend.models import Album, Artist

from ..conftest import session_context


async def _make_artist(db: AsyncSession, did: str = "did:plc:drone-test") -> Artist:
    artist = Artist(
        did=did,
        handle="drone.test",
        display_name="drone test",
    )
    db.add(artist)
    await db.commit()
    await db.refresh(artist)
    return artist


async def test_get_or_create_album_returns_existing(db_session: AsyncSession) -> None:
    """second call with same (artist, title) returns existing album, created=False."""
    artist = await _make_artist(db_session)

    album_a, created_a = await get_or_create_album(
        db_session, artist, "chromatic drones", image_id=None, image_url=None
    )
    await db_session.commit()

    album_b, created_b = await get_or_create_album(
        db_session, artist, "chromatic drones", image_id=None, image_url=None
    )

    assert created_a is True
    assert created_b is False
    assert album_a.id == album_b.id


async def test_concurrent_get_or_create_album_same_title_no_duplicates(
    _engine: AsyncEngine, _clear_db: None
) -> None:
    """12 concurrent tasks on SEPARATE sessions all trying to create the same
    album must produce exactly one row, and all callers must agree on its id.

    this mirrors the 12-chromatic-drone upload scenario that caused
    MissingGreenlet failures in stg. each task uses its own AsyncSession —
    sharing a single session across coroutines is separately broken and not
    what happens in the real upload path (each upload task opens its own).
    """
    # seed artist on a dedicated session so the concurrent tasks can see it
    async with session_context(engine=_engine) as seed_db:
        artist = await _make_artist(seed_db, did="did:plc:drone-concurrent")
        artist_did = artist.did

    async def attempt() -> tuple[str, bool]:
        async with session_context(engine=_engine) as db:
            row = await db.execute(select(Artist).where(Artist.did == artist_did))
            a = row.scalar_one()
            album, created = await get_or_create_album(
                db, a, "chromatic drones", image_id=None, image_url=None
            )
            await db.commit()
            return album.id, created

    results = await asyncio.gather(*(attempt() for _ in range(12)))

    ids = {album_id for album_id, _ in results}
    assert len(ids) == 1, f"expected 1 unique album id, got {ids}"

    created_count = sum(1 for _, created in results if created)
    assert created_count == 1, (
        f"expected exactly 1 caller to see created=True, got {created_count}"
    )

    async with session_context(engine=_engine) as verify_db:
        rows = await verify_db.execute(
            select(Album).where(Album.artist_did == artist_did)
        )
        albums = rows.scalars().all()
        assert len(albums) == 1, f"expected 1 album row, found {len(albums)}"

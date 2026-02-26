"""regression test: support_gate = None must produce SQL NULL, not JSONB null."""

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track


async def test_support_gate_none_is_sql_null(db_session: AsyncSession) -> None:
    """setting support_gate = None must store SQL NULL so IS NULL queries match."""
    artist = Artist(
        did="did:plc:nullgate",
        handle="nullgate.bsky.social",
        display_name="Null Gate Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Ungated Track",
        artist_did=artist.did,
        file_id="ungated-test",
        file_type="mp3",
        support_gate=None,
    )
    db_session.add(track)
    await db_session.commit()

    # raw SQL: support_gate should be SQL NULL, not JSONB literal 'null'
    row = (
        await db_session.execute(
            sa.text(
                "SELECT support_gate IS NULL AS is_null, "
                "support_gate::text "
                "FROM tracks WHERE id = :id"
            ),
            {"id": track.id},
        )
    ).one()
    assert row.is_null is True, (
        f"expected SQL NULL but got JSONB value: {row.support_gate!r}"
    )


async def test_support_gate_none_found_by_is_null_filter(
    db_session: AsyncSession,
) -> None:
    """track with support_gate=None must be found by ORM .is_(None) filter."""
    artist = Artist(
        did="did:plc:backfillgate",
        handle="backfillgate.bsky.social",
        display_name="Backfill Gate Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Backfillable Track",
        artist_did=artist.did,
        file_id="backfillable-test",
        file_type="mp3",
        support_gate=None,
    )
    db_session.add(track)
    await db_session.commit()

    # the backfill query pattern: Track.support_gate.is_(None)
    result = await db_session.execute(
        sa.select(Track.id).where(
            Track.artist_did == artist.did,
            Track.support_gate.is_(None),
        )
    )
    found_ids = [row[0] for row in result.all()]
    assert track.id in found_ids, "track with support_gate=None not found by IS NULL"


async def test_support_gate_cleared_becomes_sql_null(
    db_session: AsyncSession,
) -> None:
    """clearing support_gate from a dict to None must produce SQL NULL."""
    artist = Artist(
        did="did:plc:cleargate",
        handle="cleargate.bsky.social",
        display_name="Clear Gate Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Was Gated Track",
        artist_did=artist.did,
        file_id="was-gated-test",
        file_type="mp3",
        support_gate={"type": "any"},
    )
    db_session.add(track)
    await db_session.commit()

    # clear the gate
    track.support_gate = None
    await db_session.commit()

    # verify SQL NULL via raw query
    row = (
        await db_session.execute(
            sa.text(
                "SELECT support_gate IS NULL AS is_null FROM tracks WHERE id = :id"
            ),
            {"id": track.id},
        )
    ).one()
    assert row.is_null is True, "clearing support_gate did not produce SQL NULL"

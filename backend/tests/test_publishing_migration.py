"""Exercise policy backfill against the previous database shape."""

import runpy
from pathlib import Path

from sqlalchemy import Connection, text
from sqlalchemy.ext.asyncio import AsyncSession

from alembic.migration import MigrationContext
from alembic.operations import Operations
from backend.models import Artist, Track, UserPreferences

MIGRATION = (
    Path(__file__).parents[1]
    / "alembic/versions/2026_09_12_005722_311b4f106c90_add_publishing_defaults.py"
)


def _upgrade(connection: Connection) -> None:
    with Operations.context(MigrationContext.configure(connection)):
        runpy.run_path(str(MIGRATION))["upgrade"]()


async def test_migration_snapshots_downloads_and_preserves_restricted_audiences(
    db_session: AsyncSession,
) -> None:
    did = "did:test:publishing-migration"
    db_session.add(Artist(did=did, handle="migration.test", display_name="Artist"))
    await db_session.flush()
    db_session.add(UserPreferences(did=did, support_url="https://support.test"))
    cases = [
        ("public", "public", None, {}, "r2"),
        ("override", "unlisted", None, {"download_policy": "open"}, "both"),
        ("supporter", "supporters", {"type": "any"}, {}, "r2"),
        ("rights", "public", {"type": "copyright"}, {}, "r2"),
        ("space", "private", None, {}, "pds"),
    ]
    for title, visibility, gate, extra, location in cases:
        db_session.add(
            Track(
                title=title,
                file_id=title,
                file_type="mp3",
                artist_did=did,
                visibility=visibility,
                support_gate=gate,
                extra=extra,
                audio_storage=location,
            )
        )
    await db_session.flush()
    for statement in (
        "ALTER TABLE tracks DROP COLUMN download_policy",
        "ALTER TABLE tracks DROP COLUMN policy_origin",
        "ALTER TABLE albums DROP COLUMN publishing_defaults",
        "ALTER TABLE user_preferences DROP COLUMN publishing_defaults",
        "ALTER TABLE user_preferences ADD COLUMN download_policy VARCHAR",
        "UPDATE user_preferences SET download_policy = 'supporters'",
    ):
        await db_session.execute(text(statement))
    connection = await db_session.connection()
    await connection.run_sync(_upgrade)
    rows = (
        (
            await db_session.execute(
                text(
                    "SELECT title, visibility, support_gate, download_policy, audio_storage, extra FROM tracks ORDER BY title"
                )
            )
        )
        .mappings()
        .all()
    )
    result = {row["title"]: dict(row) for row in rows}
    assert result["public"]["download_policy"] == "supporters"
    assert result["public"]["audio_storage"] == "r2"
    assert result["override"]["download_policy"] == "open"
    assert result["override"]["visibility"] == "unlisted"
    assert "download_policy" not in result["override"]["extra"]
    assert result["supporter"]["visibility"] == "public"
    assert result["supporter"]["support_gate"] == {"type": "any"}
    assert result["supporter"]["download_policy"] == "off"
    assert result["supporter"]["audio_storage"] == "r2_private"
    assert result["rights"]["support_gate"] == {"type": "signed_in"}
    assert result["rights"]["download_policy"] == "off"
    assert result["space"]["visibility"] == "private"
    assert result["space"]["audio_storage"] == "pds"
    assert result["space"]["download_policy"] == "off"
    defaults = await db_session.scalar(
        text("SELECT publishing_defaults FROM user_preferences WHERE did = :did"),
        {"did": did},
    )
    assert defaults["access"]["downloads"] == "supporters"

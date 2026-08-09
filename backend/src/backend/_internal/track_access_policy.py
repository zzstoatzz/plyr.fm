"""Application-owned track admission policy persistence.

Visibility is a plyr.fm product decision keyed by portable record identity. It
does not belong to the authored music record, an R2 object, or a local integer
track row. Callers include this write in the same transaction as the legacy row
until the Python backend is retired.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def upsert_track_access_policy(
    db: AsyncSession,
    *,
    record_uri: str,
    visibility: str,
    space_uri: str | None,
) -> None:
    """Persist the latest local access decision for a canonical track URI."""
    await db.execute(
        text(
            """
            INSERT INTO plyr_index.track_access_policies (
                record_uri, visibility, space_uri, write_source, observed_at_us
            ) VALUES (
                :record_uri, :visibility, :space_uri, 'local_command',
                (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
            )
            ON CONFLICT (record_uri) DO UPDATE SET
                visibility = EXCLUDED.visibility,
                space_uri = EXCLUDED.space_uri,
                write_source = EXCLUDED.write_source,
                observed_at_us = EXCLUDED.observed_at_us
            """
        ),
        {
            "record_uri": record_uri,
            "visibility": visibility,
            "space_uri": space_uri,
        },
    )

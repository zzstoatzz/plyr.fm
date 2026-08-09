"""Persistence boundary for app-served media delivery evidence.

An origin is not an authored music fact. It says that plyr.fm observed bytes at
one delivery service and verified them against the artifact CID committed to by
one exact record revision. Keeping this projection separate prevents an R2 URL
from silently becoming canonical record state.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def upsert_verified_r2_origin(
    db: AsyncSession,
    *,
    record_uri: str,
    record_cid: str,
    origin_url: str,
    media_type: str,
    artifact_cid: str,
) -> None:
    """Record a current R2 origin after its bytes match ``artifact_cid``."""
    await db.execute(
        text(
            """
            INSERT INTO plyr_index.track_delivery_origins (
                record_uri, service, record_cid, origin_url, media_type,
                artifact_cid, verification, observed_at_us
            ) VALUES (
                :record_uri, 'r2', :record_cid, :origin_url, :media_type,
                :artifact_cid, 'verified_blob_cid',
                (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
            )
            ON CONFLICT (record_uri, service) DO UPDATE SET
                record_cid = EXCLUDED.record_cid,
                origin_url = EXCLUDED.origin_url,
                media_type = EXCLUDED.media_type,
                artifact_cid = EXCLUDED.artifact_cid,
                verification = EXCLUDED.verification,
                observed_at_us = EXCLUDED.observed_at_us
            """
        ),
        {
            "record_uri": record_uri,
            "record_cid": record_cid,
            "origin_url": origin_url,
            "media_type": media_type,
            "artifact_cid": artifact_cid,
        },
    )

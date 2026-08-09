"""Canonical-URI persistence for application-owned track aggregates."""

from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from backend.models import Track

MetricWriteSource = Literal["http_play", "subsonic_scrobble"]


async def increment_track_play_count(
    db: AsyncSession,
    track: Track,
    *,
    source: MetricWriteSource,
) -> int:
    """Atomically increment canonical metrics and mirror Python compatibility.

    The URI-keyed aggregate is authoritative whenever the track has portable
    identity. The legacy integer column receives that result in the same
    transaction, so concurrent reports serialize on one metrics row and cannot
    lose increments. Pre-ATProto rows retain the legacy-only fallback.
    """
    projected = await db.scalar(
        text(
            """
            WITH metric AS (
                INSERT INTO plyr_index.track_metrics (
                    record_uri, play_count, write_source, observed_at_us
                )
                SELECT
                    atproto_record_uri,
                    play_count::bigint + 1,
                    :source,
                    (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
                FROM public.tracks
                WHERE id = :track_id
                  AND atproto_record_uri IS NOT NULL
                  AND atproto_record_uri <> ''
                ON CONFLICT (record_uri) DO UPDATE SET
                    play_count = track_metrics.play_count + 1,
                    write_source = EXCLUDED.write_source,
                    observed_at_us = EXCLUDED.observed_at_us
                RETURNING play_count
            )
            UPDATE public.tracks AS track
            SET play_count = metric.play_count::integer
            FROM metric
            WHERE track.id = :track_id
            RETURNING metric.play_count
            """
        ),
        {"track_id": track.id, "source": source},
    )
    if projected is None:
        projected = await db.scalar(
            text(
                """
                UPDATE public.tracks
                SET play_count = play_count + 1
                WHERE id = :track_id
                RETURNING play_count::bigint
                """
            ),
            {"track_id": track.id},
        )
    if projected is None:
        raise ValueError(f"track disappeared during play increment: {track.id}")

    count = int(projected)
    set_committed_value(track, "play_count", count)
    return count

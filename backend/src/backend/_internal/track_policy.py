"""Canonical-URI application-policy persistence."""

import json
from collections.abc import Mapping

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

ModerationPolicy = tuple[list[str], str | None]


async def upsert_track_access_policy(
    db: AsyncSession,
    *,
    record_uri: str,
    visibility: str,
    space_uri: str | None,
) -> None:
    """Persist access without disturbing independently sourced moderation."""
    await db.execute(
        text(
            """
            INSERT INTO plyr_index.track_policies (
                record_uri, visibility, space_uri,
                access_write_source, access_observed_at_us, operator_labels
            ) VALUES (
                :record_uri, :visibility, :space_uri, 'local_command',
                (extract(epoch FROM clock_timestamp()) * 1000000)::bigint,
                '[]'::jsonb
            )
            ON CONFLICT (record_uri) DO UPDATE SET
                visibility = EXCLUDED.visibility,
                space_uri = EXCLUDED.space_uri,
                access_write_source = EXCLUDED.access_write_source,
                access_observed_at_us = EXCLUDED.access_observed_at_us
            """
        ),
        {
            "record_uri": record_uri,
            "visibility": visibility,
            "space_uri": space_uri,
        },
    )


async def replace_track_moderation_policies(
    db: AsyncSession,
    policies: Mapping[str, ModerationPolicy],
) -> None:
    """Replace moderation claims without disturbing independent access state."""
    await db.execute(
        text(
            """
            DELETE FROM plyr_index.track_policies
            WHERE visibility IS NULL
              AND moderation_write_source IS NOT NULL
            """
        )
    )
    await db.execute(
        text(
            """
            UPDATE plyr_index.track_policies
            SET operator_labels = '[]'::jsonb,
                moderation_decision = NULL,
                moderation_write_source = NULL,
                moderation_observed_at_us = NULL
            WHERE moderation_write_source IS NOT NULL
            """
        )
    )
    for record_uri, (labels, decision) in sorted(policies.items()):
        normalized = sorted(set(labels))
        if not normalized and decision is None:
            continue
        await db.execute(
            text(
                """
                INSERT INTO plyr_index.track_policies (
                    record_uri, operator_labels, moderation_decision,
                    moderation_write_source, moderation_observed_at_us
                ) VALUES (
                    :record_uri, CAST(:operator_labels AS jsonb), :decision,
                    'labeler_sync',
                    (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
                )
                ON CONFLICT (record_uri) DO UPDATE SET
                    operator_labels = EXCLUDED.operator_labels,
                    moderation_decision = EXCLUDED.moderation_decision,
                    moderation_write_source = EXCLUDED.moderation_write_source,
                    moderation_observed_at_us = EXCLUDED.moderation_observed_at_us
                """
            ),
            {
                "record_uri": record_uri,
                "operator_labels": json.dumps(normalized),
                "decision": decision,
            },
        )

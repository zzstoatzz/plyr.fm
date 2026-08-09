"""add track moderation policies

Revision ID: e53a9d6c214f
Revises: d42f8c5b103e
Create Date: 2026-08-09 05:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e53a9d6c214f"
down_revision: str | Sequence[str] | None = "d42f8c5b103e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add separately sourced moderation claims to the policy projection."""
    op.add_column(
        "track_policies",
        sa.Column(
            "operator_labels",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
        schema="plyr_index",
    )
    op.add_column(
        "track_policies",
        sa.Column("moderation_decision", sa.Text(), nullable=True),
        schema="plyr_index",
    )
    op.add_column(
        "track_policies",
        sa.Column("moderation_write_source", sa.Text(), nullable=True),
        schema="plyr_index",
    )
    op.add_column(
        "track_policies",
        sa.Column("moderation_observed_at_us", sa.BigInteger(), nullable=True),
        schema="plyr_index",
    )
    op.create_check_constraint(
        "ck_track_policies_labels",
        "track_policies",
        "jsonb_typeof(operator_labels) = 'array' "
        'AND operator_labels <@ \'["copyright-violation", "porn", "sexual"]\'::jsonb '
        "AND jsonb_array_length(operator_labels) <= 3",
        schema="plyr_index",
    )
    op.create_check_constraint(
        "ck_track_policies_moderation_decision",
        "track_policies",
        "moderation_decision IS NULL OR moderation_decision IN ('allow', 'exclude')",
        schema="plyr_index",
    )
    op.create_check_constraint(
        "ck_track_policies_moderation_shape",
        "track_policies",
        "(jsonb_array_length(operator_labels) = 0 "
        "AND moderation_decision IS NULL "
        "AND moderation_write_source IS NULL "
        "AND moderation_observed_at_us IS NULL) "
        "OR ((jsonb_array_length(operator_labels) > 0 "
        "OR moderation_decision IS NOT NULL) "
        "AND moderation_write_source IN ('legacy_import', 'labeler_sync') "
        "AND moderation_observed_at_us >= 0)",
        schema="plyr_index",
    )
    op.create_check_constraint(
        "ck_track_policies_nonempty",
        "track_policies",
        "visibility IS NOT NULL OR jsonb_array_length(operator_labels) > 0 "
        "OR moderation_decision IS NOT NULL",
        schema="plyr_index",
    )

    # Transitional import only. The labeler remains authoritative and the
    # reconciliation task replaces these fields from its complete view.
    op.execute(
        """
        INSERT INTO plyr_index.track_policies (
            record_uri, operator_labels, moderation_decision,
            moderation_write_source, moderation_observed_at_us
        )
        SELECT
            t.atproto_record_uri,
            to_jsonb(ARRAY(
                SELECT value
                FROM jsonb_array_elements_text(t.operator_labels) AS value
                WHERE value IN ('copyright-violation', 'porn', 'sexual')
                ORDER BY value
            )),
            CASE
                WHEN t.moderation_override IN ('allow', 'exclude')
                THEN t.moderation_override
                ELSE NULL
            END,
            'legacy_import',
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
        FROM public.tracks AS t
        WHERE t.atproto_record_uri IS NOT NULL
          AND t.atproto_record_uri <> ''
          AND (
              t.operator_labels ?| ARRAY[
                  'copyright-violation', 'porn', 'sexual'
              ]
              OR t.moderation_override IN ('allow', 'exclude')
          )
        ON CONFLICT (record_uri) DO UPDATE SET
            operator_labels = EXCLUDED.operator_labels,
            moderation_decision = EXCLUDED.moderation_decision,
            moderation_write_source = EXCLUDED.moderation_write_source,
            moderation_observed_at_us = EXCLUDED.moderation_observed_at_us
        """
    )


def downgrade() -> None:
    """Remove only the moderation component of application policy."""
    for constraint in (
        "ck_track_policies_nonempty",
        "ck_track_policies_moderation_shape",
        "ck_track_policies_moderation_decision",
        "ck_track_policies_labels",
    ):
        op.drop_constraint(
            constraint,
            "track_policies",
            schema="plyr_index",
            type_="check",
        )
    for column in (
        "moderation_observed_at_us",
        "moderation_write_source",
        "moderation_decision",
        "operator_labels",
    ):
        op.drop_column("track_policies", column, schema="plyr_index")

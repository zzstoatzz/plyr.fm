"""add track metrics

Revision ID: f64b0e7d325a
Revises: e53a9d6c214f
Create Date: 2026-08-09 05:15:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f64b0e7d325a"
down_revision: str | Sequence[str] | None = "e53a9d6c214f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Move application-owned play aggregates behind a canonical URI."""
    op.create_table(
        "track_metrics",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("play_count", sa.BigInteger(), nullable=False),
        sa.Column("write_source", sa.Text(), nullable=False),
        sa.Column("observed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "play_count >= 0",
            name="ck_track_metrics_play_count",
        ),
        sa.CheckConstraint(
            "write_source IN ('legacy_import', 'http_play', 'subsonic_scrobble')",
            name="ck_track_metrics_write_source",
        ),
        sa.CheckConstraint(
            "observed_at_us >= 0",
            name="ck_track_metrics_observed_at",
        ),
        schema="plyr_index",
    )

    # The counter is application-owned, not authored PDS state. This import
    # changes its storage identity from a local track row to the record URI;
    # subsequent play reports update this projection first and mirror the
    # result back only for Python compatibility.
    op.execute(
        """
        INSERT INTO plyr_index.track_metrics (
            record_uri, play_count, write_source, observed_at_us
        )
        SELECT
            atproto_record_uri,
            play_count::bigint,
            'legacy_import',
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
        FROM public.tracks
        WHERE atproto_record_uri IS NOT NULL
          AND atproto_record_uri <> ''
        ON CONFLICT (record_uri) DO NOTHING
        """
    )


def downgrade() -> None:
    """Remove the canonical metrics rollup without changing legacy counts."""
    op.drop_table("track_metrics", schema="plyr_index")

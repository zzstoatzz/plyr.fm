"""add track access policies

Revision ID: d42f8c5b103e
Revises: c31e7b4a902d
Create Date: 2026-08-09 04:45:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d42f8c5b103e"
down_revision: str | Sequence[str] | None = "c31e7b4a902d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Separate application admission policy from legacy track storage."""
    op.create_table(
        "track_access_policies",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("visibility", sa.Text(), nullable=False),
        sa.Column("space_uri", sa.Text(), nullable=True),
        sa.Column("write_source", sa.Text(), nullable=False),
        sa.Column("observed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "visibility IN ('public', 'unlisted', 'supporters', 'private')",
            name="ck_track_access_policies_visibility",
        ),
        sa.CheckConstraint(
            "(visibility = 'private') = (space_uri IS NOT NULL)",
            name="ck_track_access_policies_space",
        ),
        sa.CheckConstraint(
            "write_source IN ('legacy_import', 'local_command') "
            "AND observed_at_us >= 0",
            name="ck_track_access_policies_source_time",
        ),
        schema="plyr_index",
    )

    # One-time compatibility bridge. Steady-state writes go directly through
    # the application policy port and never depend on the local integer ID.
    op.execute(
        """
        INSERT INTO plyr_index.track_access_policies (
            record_uri, visibility, space_uri, write_source, observed_at_us
        )
        SELECT
            atproto_record_uri,
            visibility,
            space_uri,
            'legacy_import',
            (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
        FROM public.tracks
        WHERE atproto_record_uri IS NOT NULL
          AND atproto_record_uri <> ''
        ON CONFLICT (record_uri) DO NOTHING
        """
    )


def downgrade() -> None:
    """Remove only the independently owned access-policy projection."""
    op.drop_table("track_access_policies", schema="plyr_index")

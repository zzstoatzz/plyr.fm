"""add track_revisions table

Revision ID: 8bd123b1513d
Revises: 9eda586624d0
Create Date: 2026-04-19 12:36:26.443159

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8bd123b1513d"
down_revision: str | Sequence[str] | None = "9eda586624d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create track_revisions table for storing previous audio versions of a track.

    column names are intentionally provider-neutral (audio_url, not r2_url) so
    swapping blob providers later doesn't leave cruft behind.
    """
    op.create_table(
        "track_revisions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("file_id", sa.String(), nullable=False),
        sa.Column("file_type", sa.String(), nullable=False),
        sa.Column("original_file_id", sa.String(), nullable=True),
        sa.Column("original_file_type", sa.String(), nullable=True),
        sa.Column("audio_storage", sa.String(), nullable=False),
        sa.Column("audio_url", sa.String(), nullable=True),
        sa.Column("pds_blob_cid", sa.String(), nullable=True),
        sa.Column("pds_blob_size", sa.Integer(), nullable=True),
        sa.Column("duration", sa.Integer(), nullable=True),
        sa.Column("was_gated", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_track_revisions_id"), "track_revisions", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_track_revisions_track_id"),
        "track_revisions",
        ["track_id"],
        unique=False,
    )
    op.create_index(
        "ix_track_revisions_track_created",
        "track_revisions",
        ["track_id", sa.literal_column("created_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    """Drop the track_revisions table."""
    op.drop_index("ix_track_revisions_track_created", table_name="track_revisions")
    op.drop_index(op.f("ix_track_revisions_track_id"), table_name="track_revisions")
    op.drop_index(op.f("ix_track_revisions_id"), table_name="track_revisions")
    op.drop_table("track_revisions")

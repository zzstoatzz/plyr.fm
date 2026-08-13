"""add verified track projection

Revision ID: b2e74a19c5d0
Revises: 91d8c4e7a2b6
Create Date: 2026-08-09 00:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b2e74a19c5d0"
down_revision: str | Sequence[str] | None = "91d8c4e7a2b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the rebuildable source-authoritative track-record projection."""
    op.create_table(
        "track_records",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("record_cid", sa.Text(), nullable=True),
        sa.Column("owner_did", sa.Text(), nullable=False),
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("rkey", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("artist_name", sa.Text(), nullable=True),
        sa.Column("file_type", sa.Text(), nullable=True),
        sa.Column("record_created_at", sa.Text(), nullable=True),
        sa.Column("audio_url", sa.Text(), nullable=True),
        sa.Column("audio_blob_cid", sa.Text(), nullable=True),
        sa.Column("audio_blob_media_type", sa.Text(), nullable=True),
        sa.Column("audio_blob_size", sa.BigInteger(), nullable=True),
        sa.Column("album", sa.Text(), nullable=True),
        sa.Column("duration_seconds", sa.BigInteger(), nullable=True),
        sa.Column(
            "featured_dids",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("support_gate_type", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "self_labels",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("commit_cid", sa.Text(), nullable=False),
        sa.Column("commit_rev", sa.Text(), nullable=False),
        sa.Column("indexed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey",
            name="ck_track_records_canonical_uri",
        ),
        sa.CheckConstraint(
            "(deleted AND record_cid IS NULL AND title IS NULL "
            "AND artist_name IS NULL AND file_type IS NULL "
            "AND record_created_at IS NULL AND audio_url IS NULL "
            "AND audio_blob_cid IS NULL AND cardinality(featured_dids) = 0 "
            "AND cardinality(self_labels) = 0) "
            "OR (NOT deleted AND record_cid IS NOT NULL AND title IS NOT NULL "
            "AND artist_name IS NOT NULL AND file_type IS NOT NULL "
            "AND record_created_at IS NOT NULL "
            "AND (audio_url IS NOT NULL OR audio_blob_cid IS NOT NULL))",
            name="ck_track_records_tombstone_shape",
        ),
        sa.CheckConstraint(
            "(audio_blob_cid IS NULL AND audio_blob_media_type IS NULL "
            "AND audio_blob_size IS NULL) OR (audio_blob_cid IS NOT NULL "
            "AND audio_blob_media_type IS NOT NULL "
            "AND audio_blob_size BETWEEN 0 AND 104857600)",
            name="ck_track_records_blob_shape",
        ),
        sa.CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="ck_track_records_duration",
        ),
        sa.CheckConstraint(
            "cardinality(featured_dids) <= 10",
            name="ck_track_records_features",
        ),
        sa.CheckConstraint(
            "cardinality(self_labels) <= 10",
            name="ck_track_records_labels",
        ),
        sa.CheckConstraint(
            "indexed_at_us >= 0",
            name="ck_track_records_indexed_at",
        ),
        sa.UniqueConstraint(
            "owner_did",
            "collection",
            "rkey",
            name="uq_track_records_repo_path",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_track_records_owner_created",
        "track_records",
        ["owner_did", "record_created_at", "record_uri"],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )


def downgrade() -> None:
    """Remove only the source-authoritative track projection."""
    op.drop_index(
        "ix_track_records_owner_created",
        table_name="track_records",
        schema="plyr_index",
    )
    op.drop_table("track_records", schema="plyr_index")

"""add verified like projection

Revision ID: d71a2c9e4f83
Revises: c69d4e8a217f
Create Date: 2026-08-09 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d71a2c9e4f83"
down_revision: str | Sequence[str] | None = "c69d4e8a217f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Store authenticated PDS like records without legacy track identity."""
    op.create_table(
        "like_records",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("record_cid", sa.Text(), nullable=True),
        sa.Column("owner_did", sa.Text(), nullable=False),
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("rkey", sa.Text(), nullable=False),
        sa.Column("subject_uri", sa.Text(), nullable=True),
        sa.Column("subject_cid", sa.Text(), nullable=True),
        sa.Column("record_created_at", sa.Text(), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("commit_cid", sa.Text(), nullable=False),
        sa.Column("commit_rev", sa.Text(), nullable=False),
        sa.Column("indexed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey",
            name="ck_like_records_identity",
        ),
        sa.CheckConstraint(
            "indexed_at_us >= 0",
            name="ck_like_records_indexed_at",
        ),
        sa.CheckConstraint(
            "(deleted AND record_cid IS NULL AND subject_uri IS NULL "
            "AND subject_cid IS NULL AND record_created_at IS NULL) OR "
            "(NOT deleted AND record_cid IS NOT NULL AND subject_uri IS NOT NULL "
            "AND subject_cid IS NOT NULL AND record_created_at IS NOT NULL)",
            name="ck_like_records_live_or_tombstone",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_like_records_subject_live",
        "like_records",
        ["subject_uri"],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )
    op.create_index(
        "ix_like_records_owner_live",
        "like_records",
        ["owner_did", sa.text("record_created_at DESC"), sa.text("record_uri DESC")],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )


def downgrade() -> None:
    """Remove only the rebuildable verified-like projection."""
    op.drop_index(
        "ix_like_records_owner_live",
        table_name="like_records",
        schema="plyr_index",
    )
    op.drop_index(
        "ix_like_records_subject_live",
        table_name="like_records",
        schema="plyr_index",
    )
    op.drop_table("like_records", schema="plyr_index")

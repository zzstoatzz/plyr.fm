"""add verified profile projection

Revision ID: d5a97c8f1e42
Revises: b2e74a19c5d0
Create Date: 2026-08-09 00:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d5a97c8f1e42"
down_revision: str | Sequence[str] | None = "b2e74a19c5d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the rebuildable source-authoritative authored-profile projection."""
    op.create_table(
        "profile_records",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("record_cid", sa.Text(), nullable=True),
        sa.Column("owner_did", sa.Text(), nullable=False),
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("rkey", sa.Text(), nullable=False),
        sa.Column("avatar", sa.Text(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("record_created_at", sa.Text(), nullable=True),
        sa.Column("record_updated_at", sa.Text(), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("commit_cid", sa.Text(), nullable=False),
        sa.Column("commit_rev", sa.Text(), nullable=False),
        sa.Column("indexed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "record_uri = 'at://' || owner_did || '/' || collection || '/self'",
            name="ck_profile_records_canonical_uri",
        ),
        sa.CheckConstraint("rkey = 'self'", name="ck_profile_records_literal_key"),
        sa.CheckConstraint(
            "(deleted AND record_cid IS NULL AND avatar IS NULL AND bio IS NULL "
            "AND record_created_at IS NULL AND record_updated_at IS NULL) "
            "OR (NOT deleted AND record_cid IS NOT NULL "
            "AND record_created_at IS NOT NULL)",
            name="ck_profile_records_tombstone_shape",
        ),
        sa.CheckConstraint(
            "indexed_at_us >= 0",
            name="ck_profile_records_indexed_at",
        ),
        sa.UniqueConstraint(
            "owner_did",
            "collection",
            "rkey",
            name="uq_profile_records_repo_path",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_profile_records_owner",
        "profile_records",
        ["owner_did"],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )


def downgrade() -> None:
    """Remove only the source-authoritative authored-profile projection."""
    op.drop_index(
        "ix_profile_records_owner",
        table_name="profile_records",
        schema="plyr_index",
    )
    op.drop_table("profile_records", schema="plyr_index")

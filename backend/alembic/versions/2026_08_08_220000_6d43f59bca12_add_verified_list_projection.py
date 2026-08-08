"""add verified list projection

Revision ID: 6d43f59bca12
Revises: 4aaed6c819f1
Create Date: 2026-08-08 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "6d43f59bca12"
down_revision: str | Sequence[str] | None = "4aaed6c819f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the rebuildable list-record and ordered-membership projection."""
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS plyr_index"))
    op.create_table(
        "list_records",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("record_cid", sa.Text(), nullable=True),
        sa.Column("owner_did", sa.Text(), nullable=False),
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("rkey", sa.Text(), nullable=False),
        sa.Column("list_type", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("record_created_at", sa.Text(), nullable=True),
        sa.Column("record_updated_at", sa.Text(), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("commit_cid", sa.Text(), nullable=False),
        sa.Column("commit_rev", sa.Text(), nullable=False),
        sa.Column("indexed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey",
            name="ck_list_records_canonical_uri",
        ),
        sa.CheckConstraint(
            "(deleted AND record_cid IS NULL AND list_type IS NULL "
            "AND record_created_at IS NULL AND record_updated_at IS NULL) "
            "OR (NOT deleted AND record_cid IS NOT NULL "
            "AND list_type IS NOT NULL AND record_created_at IS NOT NULL)",
            name="ck_list_records_tombstone_shape",
        ),
        sa.CheckConstraint(
            "deleted OR list_type IN ('album', 'playlist', 'liked')",
            name="ck_list_records_type",
        ),
        sa.CheckConstraint("indexed_at_us >= 0", name="ck_list_records_indexed_at"),
        sa.UniqueConstraint(
            "owner_did",
            "collection",
            "rkey",
            name="uq_list_records_repo_path",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_list_records_owner_type",
        "list_records",
        ["owner_did", "list_type"],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )
    op.create_table(
        "list_members",
        sa.Column("list_uri", sa.Text(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("track_uri", sa.Text(), nullable=False),
        sa.Column("track_cid", sa.Text(), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_list_members_position"),
        sa.ForeignKeyConstraint(
            ["list_uri"],
            ["plyr_index.list_records.record_uri"],
            name="fk_list_members_record",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("list_uri", "position", name="pk_list_members"),
        schema="plyr_index",
    )
    op.create_index(
        "ix_list_members_track_uri",
        "list_members",
        ["track_uri"],
        unique=False,
        schema="plyr_index",
    )


def downgrade() -> None:
    """Remove only the Zig-owned projection objects."""
    op.drop_index(
        "ix_list_members_track_uri",
        table_name="list_members",
        schema="plyr_index",
    )
    op.drop_table("list_members", schema="plyr_index")
    op.drop_index(
        "ix_list_records_owner_type",
        table_name="list_records",
        schema="plyr_index",
    )
    op.drop_table("list_records", schema="plyr_index")
    op.execute(sa.text("DROP SCHEMA plyr_index"))

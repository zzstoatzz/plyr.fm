"""add verified record rejections

Revision ID: a8d20f4bc731
Revises: f7c19e4a3b82
Create Date: 2026-08-09 01:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a8d20f4bc731"
down_revision: str | Sequence[str] | None = "f7c19e4a3b82"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Persist authenticated records excluded from application projections."""
    op.create_table(
        "record_rejections",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("record_cid", sa.Text(), nullable=False),
        sa.Column("owner_did", sa.Text(), nullable=False),
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("rkey", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("commit_cid", sa.Text(), nullable=False),
        sa.Column("commit_rev", sa.Text(), nullable=False),
        sa.Column("indexed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "reason IN ('invalid_dag_cbor', 'invalid_schema')",
            name="ck_record_rejections_reason",
        ),
        sa.CheckConstraint(
            "length(detail) BETWEEN 1 AND 128 AND indexed_at_us >= 0",
            name="ck_record_rejections_detail_time",
        ),
        sa.UniqueConstraint(
            "owner_did",
            "collection",
            "rkey",
            name="uq_record_rejections_repo_path",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_record_rejections_owner_collection",
        "record_rejections",
        ["owner_did", "collection"],
        schema="plyr_index",
    )


def downgrade() -> None:
    """Remove only durable malformed-record exclusion evidence."""
    op.drop_index(
        "ix_record_rejections_owner_collection",
        table_name="record_rejections",
        schema="plyr_index",
    )
    op.drop_table("record_rejections", schema="plyr_index")

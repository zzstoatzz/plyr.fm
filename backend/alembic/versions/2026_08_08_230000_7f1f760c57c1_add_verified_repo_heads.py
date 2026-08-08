"""add verified repository heads

Revision ID: 7f1f760c57c1
Revises: 6d43f59bca12
Create Date: 2026-08-08 23:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7f1f760c57c1"
down_revision: str | Sequence[str] | None = "6d43f59bca12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Persist the authenticated repository head that gates live commits."""
    op.create_table(
        "repo_heads",
        sa.Column("repo_did", sa.Text(), primary_key=True),
        sa.Column("commit_rev", sa.Text(), nullable=False),
        sa.Column("commit_cid", sa.Text(), nullable=False),
        sa.Column("data_cid", sa.Text(), nullable=False),
        sa.Column("indexed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "repo_did ~ '^did:[a-z0-9]+:.+$'",
            name="ck_repo_heads_did",
        ),
        sa.CheckConstraint(
            "commit_rev ~ '^[234567abcdefghijklmnopqrstuvwxyz]{13}$'",
            name="ck_repo_heads_tid",
        ),
        sa.CheckConstraint(
            "commit_cid ~ '^b[a-z2-7]+$' AND data_cid ~ '^b[a-z2-7]+$'",
            name="ck_repo_heads_cids",
        ),
        sa.CheckConstraint(
            "indexed_at_us >= 0",
            name="ck_repo_heads_indexed_at",
        ),
        schema="plyr_index",
    )


def downgrade() -> None:
    """Remove verified repository chain state before projection teardown."""
    op.drop_table("repo_heads", schema="plyr_index")

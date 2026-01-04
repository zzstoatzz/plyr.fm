"""add pending add accounts table

Revision ID: 5d2522e9f7e9
Revises: 3e972db238c6
Create Date: 2026-01-03 18:41:57.612374

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5d2522e9f7e9"
down_revision: str | Sequence[str] | None = "3e972db238c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add pending_add_accounts table for multi-account OAuth flow tracking."""
    op.create_table(
        "pending_add_accounts",
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column("group_id", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("state"),
    )
    op.create_index(
        "ix_pending_add_accounts_state", "pending_add_accounts", ["state"], unique=False
    )
    op.create_index(
        "ix_pending_add_accounts_group_id",
        "pending_add_accounts",
        ["group_id"],
        unique=False,
    )
    op.create_index(
        "ix_pending_add_accounts_created_at",
        "pending_add_accounts",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Remove pending_add_accounts table."""
    op.drop_index(
        "ix_pending_add_accounts_created_at", table_name="pending_add_accounts"
    )
    op.drop_index("ix_pending_add_accounts_group_id", table_name="pending_add_accounts")
    op.drop_index("ix_pending_add_accounts_state", table_name="pending_add_accounts")
    op.drop_table("pending_add_accounts")

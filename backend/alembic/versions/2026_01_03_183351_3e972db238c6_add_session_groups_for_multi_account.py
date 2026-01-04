"""add session groups for multi-account

Revision ID: 3e972db238c6
Revises: 15472c0b3bb4
Create Date: 2026-01-03 18:33:51.017398

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3e972db238c6"
down_revision: str | Sequence[str] | None = "15472c0b3bb4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add session groups for multi-account support."""
    # add group_id to user_sessions (nullable initially for existing sessions)
    op.add_column(
        "user_sessions",
        sa.Column("group_id", sa.String(64), nullable=True),
    )
    # add is_active flag (default true for existing sessions)
    op.add_column(
        "user_sessions",
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    # add avatar_url for quick display in account switcher
    op.add_column(
        "user_sessions",
        sa.Column("avatar_url", sa.String(500), nullable=True),
    )
    # index for fast group lookups
    op.create_index("ix_user_sessions_group_id", "user_sessions", ["group_id"])


def downgrade() -> None:
    """Remove session groups."""
    op.drop_index("ix_user_sessions_group_id", table_name="user_sessions")
    op.drop_column("user_sessions", "avatar_url")
    op.drop_column("user_sessions", "is_active")
    op.drop_column("user_sessions", "group_id")

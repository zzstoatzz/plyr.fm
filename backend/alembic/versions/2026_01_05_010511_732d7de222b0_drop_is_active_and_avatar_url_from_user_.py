"""drop is_active and avatar_url from user_sessions

Revision ID: 732d7de222b0
Revises: 5d2522e9f7e9
Create Date: 2026-01-05 01:05:11.606841

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "732d7de222b0"
down_revision: str | Sequence[str] | None = "5d2522e9f7e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Remove unused session columns."""
    op.drop_column("user_sessions", "is_active")
    op.drop_column("user_sessions", "avatar_url")


def downgrade() -> None:
    """Restore session columns."""
    op.add_column(
        "user_sessions",
        sa.Column("avatar_url", sa.VARCHAR(length=500), nullable=True),
    )
    op.add_column(
        "user_sessions",
        sa.Column(
            "is_active",
            sa.BOOLEAN(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )

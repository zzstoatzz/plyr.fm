"""add theme column to user_preferences

Revision ID: 40474bbaccb1
Revises: 298ad5c58e0e
Create Date: 2026-03-16 19:02:07.848608

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "40474bbaccb1"
down_revision: str | Sequence[str] | None = "298ad5c58e0e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "theme", sa.String(), server_default=sa.text("'dark'"), nullable=False
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "theme")

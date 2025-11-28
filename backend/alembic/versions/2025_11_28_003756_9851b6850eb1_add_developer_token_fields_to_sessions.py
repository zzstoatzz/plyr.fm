"""add developer token fields to sessions

Revision ID: 9851b6850eb1
Revises: e9acf24e6885
Create Date: 2025-11-28 00:37:56.838421

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9851b6850eb1"
down_revision: str | Sequence[str] | None = "e9acf24e6885"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_sessions",
        sa.Column(
            "is_developer_token", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    op.add_column(
        "user_sessions", sa.Column("token_name", sa.String(length=100), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_sessions", "token_name")
    op.drop_column("user_sessions", "is_developer_token")

"""add support_url to user_preferences

Revision ID: a6069b752a90
Revises: 0ccb2cff4cec
Create Date: 2025-12-08 17:01:30.727995

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6069b752a90"
down_revision: str | Sequence[str] | None = "0ccb2cff4cec"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences", sa.Column("support_url", sa.String(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "support_url")

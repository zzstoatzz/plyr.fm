"""add terms_accepted_at to user_preferences

Revision ID: 883e927fdd76
Revises: 37cc1d6980c3
Create Date: 2025-12-10 18:44:04.436282

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "883e927fdd76"
down_revision: str | Sequence[str] | None = "37cc1d6980c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "terms_accepted_at")

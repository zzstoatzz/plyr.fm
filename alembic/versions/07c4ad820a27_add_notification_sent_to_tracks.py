"""add notification_sent to tracks

Revision ID: 07c4ad820a27
Revises: 2d6d201752ef
Create Date: 2025-11-12 14:34:51.198866

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "07c4ad820a27"
down_revision: str | Sequence[str] | None = "2d6d201752ef"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tracks",
        sa.Column(
            "notification_sent", sa.Boolean(), nullable=False, server_default="false"
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "notification_sent")

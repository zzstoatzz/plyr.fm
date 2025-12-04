"""add enable_teal_scrobbling preference

Revision ID: d4e6457a0fe3
Revises: 0d634c0a7259
Create Date: 2025-12-03 17:27:19.016378

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e6457a0fe3"
down_revision: str | Sequence[str] | None = "0d634c0a7259"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "enable_teal_scrobbling",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "enable_teal_scrobbling")

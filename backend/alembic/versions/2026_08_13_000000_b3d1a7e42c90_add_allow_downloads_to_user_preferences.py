"""add allow_downloads to user_preferences

Revision ID: b3d1a7e42c90
Revises: 4aaed6c819f1
Create Date: 2026-08-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3d1a7e42c90"
down_revision: str | Sequence[str] | None = "4aaed6c819f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "allow_downloads",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "allow_downloads")

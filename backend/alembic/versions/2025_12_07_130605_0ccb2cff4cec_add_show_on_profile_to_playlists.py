"""add show_on_profile to playlists

Revision ID: 0ccb2cff4cec
Revises: 7a1bce049e3f
Create Date: 2025-12-07 13:06:05.533671

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0ccb2cff4cec"
down_revision: str | Sequence[str] | None = "7a1bce049e3f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "playlists",
        sa.Column(
            "show_on_profile", sa.Boolean(), nullable=False, server_default="false"
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("playlists", "show_on_profile")

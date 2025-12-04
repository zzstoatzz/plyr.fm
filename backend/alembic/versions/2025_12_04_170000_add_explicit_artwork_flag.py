"""add explicit_artwork to tracks and show_explicit_artwork preference

Revision ID: a1b2c3d4e5f6
Revises: d4e6457a0fe3
Create Date: 2025-12-04 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "d4e6457a0fe3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # add explicit_artwork flag to tracks (default false - most artwork is safe)
    op.add_column(
        "tracks",
        sa.Column(
            "explicit_artwork",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )

    # add show_explicit_artwork preference (default false - blur by default)
    op.add_column(
        "user_preferences",
        sa.Column(
            "show_explicit_artwork",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "show_explicit_artwork")
    op.drop_column("tracks", "explicit_artwork")

"""add playlist image columns

Revision ID: 7a1bce049e3f
Revises: add_playlists_table
Create Date: 2025-12-07 12:42:59.996580

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7a1bce049e3f"
down_revision: str | Sequence[str] | None = "add_playlists_table"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("playlists", sa.Column("image_id", sa.String(), nullable=True))
    op.add_column("playlists", sa.Column("image_url", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("playlists", "image_url")
    op.drop_column("playlists", "image_id")

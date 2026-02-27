"""add thumbnail_url column

Revision ID: a1b2c3d4e5f6
Revises: 97e520a2e2fa
Create Date: 2026-02-27 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "97e520a2e2fa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable thumbnail_url column to tracks, albums, and playlists."""
    op.add_column("tracks", sa.Column("thumbnail_url", sa.String(), nullable=True))
    op.add_column("albums", sa.Column("thumbnail_url", sa.String(), nullable=True))
    op.add_column("playlists", sa.Column("thumbnail_url", sa.String(), nullable=True))


def downgrade() -> None:
    """Remove thumbnail_url columns."""
    op.drop_column("playlists", "thumbnail_url")
    op.drop_column("albums", "thumbnail_url")
    op.drop_column("tracks", "thumbnail_url")

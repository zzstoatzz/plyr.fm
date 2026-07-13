"""add playlist preview thumbnails

Revision ID: a1c4f2b7d3e9
Revises: 816ec59cc00a
Create Date: 2026-07-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c4f2b7d3e9"
down_revision: str | Sequence[str] | None = "816ec59cc00a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add cached member-track artwork previews to playlists.

    up to 4 distinct artwork URLs in playlist order, used to render a
    composite cover when the playlist has no explicit image. refreshed on
    item mutations and self-healed on detail reads.
    """
    op.add_column(
        "playlists",
        sa.Column("preview_thumbnails", JSONB(), nullable=True),
    )


def downgrade() -> None:
    """Remove cached artwork previews from playlists."""
    op.drop_column("playlists", "preview_thumbnails")

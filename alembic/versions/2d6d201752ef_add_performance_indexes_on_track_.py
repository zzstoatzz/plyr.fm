"""add performance indexes on track created_at and track_likes

Revision ID: 2d6d201752ef
Revises: 14fff0296365
Create Date: 2025-11-12 02:06:23.954048

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2d6d201752ef"
down_revision: str | Sequence[str] | None = "14fff0296365"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # add index on tracks.created_at for ORDER BY and range queries
    op.create_index(
        op.f("ix_tracks_created_at"), "tracks", ["created_at"], unique=False
    )

    # add composite index on track_likes for efficient user likes queries with sorting
    op.create_index(
        "ix_track_likes_user_did_created_at",
        "track_likes",
        ["user_did", sa.text("created_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_track_likes_user_did_created_at", table_name="track_likes")
    op.drop_index(op.f("ix_tracks_created_at"), table_name="tracks")

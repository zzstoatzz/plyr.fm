"""add activity feed indexes

Revision ID: a3d9fe3d8d02
Revises: 75e853113f1b
Create Date: 2026-03-02 01:12:16.153266

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3d9fe3d8d02"
down_revision: str | Sequence[str] | None = "75e853113f1b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add created_at DESC indexes for activity feed query."""
    op.create_index(
        "ix_artists_created_at",
        "artists",
        [sa.literal_column("created_at DESC")],
    )
    op.create_index(
        "ix_track_likes_created_at",
        "track_likes",
        [sa.literal_column("created_at DESC")],
    )
    op.create_index(
        "ix_track_comments_created_at",
        "track_comments",
        [sa.literal_column("created_at DESC")],
    )


def downgrade() -> None:
    """Remove activity feed indexes."""
    op.drop_index("ix_track_comments_created_at", table_name="track_comments")
    op.drop_index("ix_track_likes_created_at", table_name="track_likes")
    op.drop_index("ix_artists_created_at", table_name="artists")

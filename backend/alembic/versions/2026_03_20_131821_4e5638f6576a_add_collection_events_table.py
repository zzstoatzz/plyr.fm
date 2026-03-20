"""add collection events table

Revision ID: 4e5638f6576a
Revises: 40474bbaccb1
Create Date: 2026-03-20 13:18:21.331882

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4e5638f6576a"
down_revision: str | Sequence[str] | None = "40474bbaccb1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "collection_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("actor_did", sa.String(), nullable=False),
        sa.Column("playlist_id", sa.String(), nullable=True),
        sa.Column("album_id", sa.String(), nullable=True),
        sa.Column("track_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["actor_did"],
            ["artists.did"],
        ),
        sa.ForeignKeyConstraint(["album_id"], ["albums.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_collection_events_actor_did",
        "collection_events",
        ["actor_did"],
        unique=False,
    )
    op.create_index(
        "ix_collection_events_created_at",
        "collection_events",
        [sa.literal_column("created_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_collection_events_created_at", table_name="collection_events")
    op.drop_index("ix_collection_events_actor_did", table_name="collection_events")
    op.drop_table("collection_events")

"""add track plays

Revision ID: 8c9f4bcf1ec3
Revises: 4b8b60103ed2
Create Date: 2026-10-23 02:13:58.460726

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c9f4bcf1ec3"
down_revision: str | Sequence[str] | None = "4b8b60103ed2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "track_plays",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "track_id", "played_at", "source", name="uq_track_plays_event"
        ),
    )
    op.create_index(
        op.f("ix_track_plays_played_at"), "track_plays", ["played_at"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_track_plays_played_at"), table_name="track_plays")
    op.drop_table("track_plays")

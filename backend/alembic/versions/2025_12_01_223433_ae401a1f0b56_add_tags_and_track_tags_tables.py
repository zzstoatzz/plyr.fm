"""add tags and track_tags tables

Revision ID: ae401a1f0b56
Revises: e3d1b1eebe4b
Create Date: 2025-12-01 22:34:33.326665

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ae401a1f0b56"
down_revision: str | Sequence[str] | None = "e3d1b1eebe4b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    existing_tables = inspector.get_table_names()

    # create tags table
    if "tags" not in existing_tables:
        op.create_table(
            "tags",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("created_by_did", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["created_by_did"],
                ["artists.did"],
                name="fk_tags_created_by_did",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_tags_id"), "tags", ["id"], unique=False)
        op.create_index(op.f("ix_tags_name"), "tags", ["name"], unique=True)
        op.create_index(
            op.f("ix_tags_created_by_did"), "tags", ["created_by_did"], unique=False
        )

    # create track_tags join table
    if "track_tags" not in existing_tables:
        op.create_table(
            "track_tags",
            sa.Column("track_id", sa.Integer(), nullable=False),
            sa.Column("tag_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(
                ["track_id"],
                ["tracks.id"],
                name="fk_track_tags_track_id",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["tag_id"],
                ["tags.id"],
                name="fk_track_tags_tag_id",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("track_id", "tag_id"),
        )
        op.create_index("ix_track_tags_tag_id", "track_tags", ["tag_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("track_tags")
    op.drop_table("tags")

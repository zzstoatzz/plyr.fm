"""add track_comments table and allow_comments preference

Revision ID: 20d550e3d14b
Revises: b8a3d4500bb6
Create Date: 2025-11-25 23:38:43.896501

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20d550e3d14b"
down_revision: str | Sequence[str] | None = "b8a3d4500bb6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # check if track_comments table already exists (dev has it)
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    existing_tables = inspector.get_table_names()

    if "track_comments" not in existing_tables:
        op.create_table(
            "track_comments",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("track_id", sa.Integer(), nullable=False),
            sa.Column("user_did", sa.String(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("timestamp_ms", sa.Integer(), nullable=False),
            sa.Column("atproto_comment_uri", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_track_comments_id"), "track_comments", ["id"], unique=False
        )
        op.create_index(
            op.f("ix_track_comments_track_id"),
            "track_comments",
            ["track_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_track_comments_user_did"),
            "track_comments",
            ["user_did"],
            unique=False,
        )
        op.create_index(
            op.f("ix_track_comments_atproto_comment_uri"),
            "track_comments",
            ["atproto_comment_uri"],
            unique=True,
        )
        op.create_index(
            "ix_track_comments_track_timestamp",
            "track_comments",
            ["track_id", "timestamp_ms"],
            unique=False,
        )
        op.create_index(
            "ix_track_comments_user_created",
            "track_comments",
            ["user_did", "created_at"],
            unique=False,
        )

    # add allow_comments to user_preferences (check if column exists first)
    existing_columns = [
        col["name"] for col in inspector.get_columns("user_preferences")
    ]
    if "allow_comments" not in existing_columns:
        op.add_column(
            "user_preferences",
            sa.Column(
                "allow_comments",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "allow_comments")
    op.drop_table("track_comments")

"""add playlists table

Revision ID: add_playlists_table
Revises: 6c07ebda9721
Create Date: 2025-12-07 12:15:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_playlists_table"
down_revision: str | Sequence[str] | None = "6c07ebda9721"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create playlists table for caching ATProto list records."""
    op.create_table(
        "playlists",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "owner_did",
            sa.String(),
            sa.ForeignKey("artists.did"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("atproto_record_uri", sa.String(), nullable=False, unique=True),
        sa.Column("atproto_record_cid", sa.String(), nullable=False),
        sa.Column("track_count", sa.Integer(), default=0),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    # create index on atproto_record_uri for fast lookups
    op.create_index(
        "ix_playlists_atproto_record_uri",
        "playlists",
        ["atproto_record_uri"],
        unique=True,
    )


def downgrade() -> None:
    """Drop playlists table."""
    op.drop_index("ix_playlists_atproto_record_uri", table_name="playlists")
    op.drop_table("playlists")

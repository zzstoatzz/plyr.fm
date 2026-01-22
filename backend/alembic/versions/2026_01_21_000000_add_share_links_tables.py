"""add share links tables for listen receipts

Revision ID: add_share_links_tables
Revises: merge_883e927_732d7de
Create Date: 2026-01-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_share_links_tables"
down_revision: str | Sequence[str] | None = "merge_883e927_732d7de"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create share_links and share_link_events tables for tracking shared track links."""
    # create share_links table
    op.create_table(
        "share_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("creator_did", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_share_links_id", "share_links", ["id"], unique=False)
    op.create_index("ix_share_links_code", "share_links", ["code"], unique=True)
    op.create_index(
        "ix_share_links_track_id", "share_links", ["track_id"], unique=False
    )
    op.create_index(
        "ix_share_links_creator_did", "share_links", ["creator_did"], unique=False
    )
    op.create_index(
        "ix_share_links_creator_did_created_at",
        "share_links",
        ["creator_did", sa.text("created_at DESC")],
        unique=False,
    )

    # create share_link_events table
    op.create_table(
        "share_link_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("share_link_id", sa.Integer(), nullable=False),
        sa.Column("visitor_did", sa.String(), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["share_link_id"], ["share_links.id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_share_link_events_id", "share_link_events", ["id"], unique=False
    )
    op.create_index(
        "ix_share_link_events_share_link_id",
        "share_link_events",
        ["share_link_id"],
        unique=False,
    )
    op.create_index(
        "ix_share_link_events_visitor_did",
        "share_link_events",
        ["visitor_did"],
        unique=False,
    )
    op.create_index(
        "ix_share_link_events_link_type",
        "share_link_events",
        ["share_link_id", "event_type"],
        unique=False,
    )


def downgrade() -> None:
    """Drop share_link_events and share_links tables."""
    # drop share_link_events indexes and table
    op.drop_index("ix_share_link_events_link_type", table_name="share_link_events")
    op.drop_index("ix_share_link_events_visitor_did", table_name="share_link_events")
    op.drop_index("ix_share_link_events_share_link_id", table_name="share_link_events")
    op.drop_index("ix_share_link_events_id", table_name="share_link_events")
    op.drop_table("share_link_events")

    # drop share_links indexes and table
    op.drop_index("ix_share_links_creator_did_created_at", table_name="share_links")
    op.drop_index("ix_share_links_creator_did", table_name="share_links")
    op.drop_index("ix_share_links_track_id", table_name="share_links")
    op.drop_index("ix_share_links_code", table_name="share_links")
    op.drop_index("ix_share_links_id", table_name="share_links")
    op.drop_table("share_links")

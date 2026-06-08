"""collapse track visibility flags into visibility enum

Revision ID: 816ec59cc00a
Revises: 0387de28f52e
Create Date: 2026-06-08 13:09:45.800361

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "816ec59cc00a"
down_revision: str | Sequence[str] | None = "0387de28f52e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Collapse `unlisted` + `is_private` booleans into one `visibility` enum.

    backfill precedence: private > supporters (support_gate type=any) > unlisted >
    public. copyright gating (support_gate type=copyright) is orthogonal and stays
    on a public/unlisted track, so it doesn't map to a visibility value.
    """
    op.add_column(
        "tracks",
        sa.Column(
            "visibility",
            sa.String(),
            nullable=False,
            server_default="public",
        ),
    )
    op.execute(
        """
        UPDATE tracks SET visibility = CASE
            WHEN is_private THEN 'private'
            WHEN support_gate->>'type' = 'any' THEN 'supporters'
            WHEN unlisted THEN 'unlisted'
            ELSE 'public'
        END
        """
    )
    op.create_index(op.f("ix_tracks_visibility"), "tracks", ["visibility"])
    op.drop_column("tracks", "is_private")
    op.drop_column("tracks", "unlisted")


def downgrade() -> None:
    """Restore the `unlisted` + `is_private` booleans from `visibility`."""
    op.add_column(
        "tracks",
        sa.Column("unlisted", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "tracks",
        sa.Column("is_private", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.execute(
        """
        UPDATE tracks SET
            is_private = (visibility = 'private'),
            unlisted = (visibility IN ('unlisted', 'private'))
        """
    )
    op.drop_index(op.f("ix_tracks_visibility"), table_name="tracks")
    op.drop_column("tracks", "visibility")

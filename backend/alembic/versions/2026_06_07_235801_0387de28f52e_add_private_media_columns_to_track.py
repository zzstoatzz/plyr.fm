"""add private media columns to track

Revision ID: 0387de28f52e
Revises: e9ec24f00cd1
Create Date: 2026-06-07 23:58:01.576185

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0387de28f52e"
down_revision: str | Sequence[str] | None = "e9ec24f00cd1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add permissioned private-media columns to tracks.

    private tracks store their audio blob + record in the artist's permissioned
    space on their PDS; space_uri is the 3-segment ats:// space URI.
    """
    op.add_column(
        "tracks",
        sa.Column("is_private", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "tracks",
        sa.Column("space_uri", sa.String(), nullable=True),
    )


def downgrade() -> None:
    """Remove permissioned private-media columns from tracks."""
    op.drop_column("tracks", "space_uri")
    op.drop_column("tracks", "is_private")

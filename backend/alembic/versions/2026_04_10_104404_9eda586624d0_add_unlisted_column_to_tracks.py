"""add unlisted column to tracks

Revision ID: 9eda586624d0
Revises: 4e5638f6576a
Create Date: 2026-04-10 10:44:04.227029

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9eda586624d0"
down_revision: str | None = "4e5638f6576a"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Add unlisted boolean column to tracks table."""
    op.add_column(
        "tracks",
        sa.Column("unlisted", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    """Remove unlisted column from tracks table."""
    op.drop_column("tracks", "unlisted")

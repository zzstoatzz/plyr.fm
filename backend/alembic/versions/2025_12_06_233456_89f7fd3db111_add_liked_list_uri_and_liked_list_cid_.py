"""add liked_list_uri and liked_list_cid to user_preferences

Revision ID: 89f7fd3db111
Revises: 358af8d5d40a
Create Date: 2025-12-06 23:34:56.508424

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "89f7fd3db111"
down_revision: str | Sequence[str] | None = "358af8d5d40a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ATProto liked list record fields to user_preferences."""
    op.add_column(
        "user_preferences",
        sa.Column("liked_list_uri", sa.String(), nullable=True),
    )
    op.add_column(
        "user_preferences",
        sa.Column("liked_list_cid", sa.String(), nullable=True),
    )


def downgrade() -> None:
    """Remove ATProto liked list record fields from user_preferences."""
    op.drop_column("user_preferences", "liked_list_cid")
    op.drop_column("user_preferences", "liked_list_uri")

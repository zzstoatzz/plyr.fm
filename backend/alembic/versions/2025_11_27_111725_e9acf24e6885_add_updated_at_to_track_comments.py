"""add updated_at to track_comments

Revision ID: e9acf24e6885
Revises: 20d550e3d14b
Create Date: 2025-11-27 11:17:25.404434

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9acf24e6885"
down_revision: str | Sequence[str] | None = "20d550e3d14b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "track_comments",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("track_comments", "updated_at")

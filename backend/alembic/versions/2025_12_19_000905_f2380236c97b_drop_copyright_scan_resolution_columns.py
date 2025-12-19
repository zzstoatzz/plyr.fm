"""drop copyright scan resolution columns

Revision ID: f2380236c97b
Revises: a1b2c3d4e5f6
Create Date: 2025-12-19 00:09:05.006236

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2380236c97b"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Remove resolution-related columns from copyright_scans.
    The labeler service is now the source of truth for resolution status,
    and the sync_copyright_resolutions background task updates is_flagged.
    """
    op.drop_column("copyright_scans", "review_notes")
    op.drop_column("copyright_scans", "reviewed_at")
    op.drop_column("copyright_scans", "resolution")
    op.drop_column("copyright_scans", "reviewed_by")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "copyright_scans",
        sa.Column("reviewed_by", sa.VARCHAR(), autoincrement=False, nullable=True),
    )
    op.add_column(
        "copyright_scans",
        sa.Column("resolution", sa.VARCHAR(), autoincrement=False, nullable=True),
    )
    op.add_column(
        "copyright_scans",
        sa.Column(
            "reviewed_at",
            postgresql.TIMESTAMP(timezone=True),
            autoincrement=False,
            nullable=True,
        ),
    )
    op.add_column(
        "copyright_scans",
        sa.Column("review_notes", sa.VARCHAR(), autoincrement=False, nullable=True),
    )

"""add notified_at to copyright_scans

Revision ID: 15472c0b3bb4
Revises: 9ee155c078ed
Create Date: 2026-01-02 14:05:13.306570

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "15472c0b3bb4"
down_revision: str | Sequence[str] | None = "9ee155c078ed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "copyright_scans",
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("copyright_scans", "notified_at")

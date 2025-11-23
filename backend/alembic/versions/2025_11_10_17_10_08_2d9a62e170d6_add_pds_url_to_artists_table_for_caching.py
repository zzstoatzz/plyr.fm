"""add pds_url to artists table for caching

Revision ID: 2d9a62e170d6
Revises: 36868f2c20e5
Create Date: 2025-11-10 17:10:08.992943

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2d9a62e170d6"
down_revision: str | Sequence[str] | None = "36868f2c20e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("artists", sa.Column("pds_url", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("artists", "pds_url")

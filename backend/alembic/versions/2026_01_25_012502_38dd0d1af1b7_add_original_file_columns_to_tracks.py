"""add_original_file_columns_to_tracks

Revision ID: 38dd0d1af1b7
Revises: 1a94c1ea171d
Create Date: 2026-01-25 01:25:02.312562

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "38dd0d1af1b7"
down_revision: str | Sequence[str] | None = "1a94c1ea171d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("tracks", sa.Column("original_file_id", sa.String(), nullable=True))
    op.add_column("tracks", sa.Column("original_file_type", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "original_file_type")
    op.drop_column("tracks", "original_file_id")

"""add track description column

Revision ID: bcf223076d43
Revises: a3d9fe3d8d02
Create Date: 2026-03-06 11:26:10.477969

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bcf223076d43"
down_revision: str | Sequence[str] | None = "a3d9fe3d8d02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("tracks", sa.Column("description", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "description")

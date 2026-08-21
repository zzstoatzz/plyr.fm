"""add spaces_unsupported_pds to artists

Revision ID: d5f3c9a62eb2
Revises: c4e2b8f51da1
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5f3c9a62eb2"
down_revision: str | Sequence[str] | None = "c4e2b8f51da1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "artists", sa.Column("spaces_unsupported_pds", sa.String(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("artists", "spaces_unsupported_pds")

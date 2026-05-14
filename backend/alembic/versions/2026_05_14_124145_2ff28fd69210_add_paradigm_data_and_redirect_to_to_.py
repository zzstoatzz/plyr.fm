"""add paradigm_data and redirect_to to pending_scope_upgrades

Revision ID: 2ff28fd69210
Revises: 16cfa67553bd
Create Date: 2026-05-14 12:41:45.668071

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2ff28fd69210"
down_revision: str | Sequence[str] | None = "16cfa67553bd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "pending_scope_upgrades",
        sa.Column("paradigm_data", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "pending_scope_upgrades",
        sa.Column("redirect_to", sa.String(length=256), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("pending_scope_upgrades", "redirect_to")
    op.drop_column("pending_scope_upgrades", "paradigm_data")

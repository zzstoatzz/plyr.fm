"""add album plylst link

Revision ID: b1050bb3430d
Revises: 3d875a858a31
Create Date: 2026-10-30 13:46:10.280151

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1050bb3430d"
down_revision: str | Sequence[str] | None = "3d875a858a31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "albums",
        sa.Column(
            "show_plylst", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("albums", "show_plylst")

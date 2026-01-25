"""add enabled_flags to artists

Revision ID: b07a9095707e
Revises: add_share_links_tables
Create Date: 2026-01-24 23:33:25.800663

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b07a9095707e"
down_revision: str | Sequence[str] | None = "add_share_links_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "artists",
        sa.Column(
            "enabled_flags",
            sa.ARRAY(sa.String(length=64)),
            server_default="{}",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("artists", "enabled_flags")

"""add artist operator labels

Revision ID: 4b8b60103ed2
Revises: 8b7936186170
Create Date: 2026-10-23 00:21:17.053567

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4b8b60103ed2"
down_revision: str | Sequence[str] | None = "8b7936186170"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "artists",
        sa.Column(
            "operator_labels",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("artists", "operator_labels")

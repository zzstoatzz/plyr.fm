"""project operator labels onto tracks

Revision ID: 581366546d5c
Revises: d4f7a2c9b831
Create Date: 2026-07-23 12:38:53.980024

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "581366546d5c"
down_revision: str | Sequence[str] | None = "d4f7a2c9b831"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tracks",
        sa.Column(
            "operator_labels",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "operator_labels")

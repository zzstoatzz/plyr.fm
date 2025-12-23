"""add support_gate to tracks

Revision ID: 9ee155c078ed
Revises: f2380236c97b
Create Date: 2025-12-22 19:01:15.063270

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9ee155c078ed"
down_revision: str | Sequence[str] | None = "f2380236c97b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add support_gate column for supporter-gated content."""
    op.add_column(
        "tracks",
        sa.Column(
            "support_gate",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Remove support_gate column."""
    op.drop_column("tracks", "support_gate")

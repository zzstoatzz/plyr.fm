"""add hidden_tags to user_preferences

Revision ID: f60f46fb6014
Revises: ae401a1f0b56
Create Date: 2025-12-01 22:58:09.031041

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f60f46fb6014"
down_revision: str | Sequence[str] | None = "ae401a1f0b56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "hidden_tags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[\"ai\"]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "hidden_tags")

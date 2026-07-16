"""add sensitive audio preference

Revision ID: b7e2c4d8a1f6
Revises: a1c4f2b7d3e9
Create Date: 2026-07-15 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e2c4d8a1f6"
down_revision: str | Sequence[str] | None = "a1c4f2b7d3e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the opt-in controlling adult-labeled audio."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "show_sensitive_audio",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove the sensitive-audio preference."""
    op.drop_column("user_preferences", "show_sensitive_audio")

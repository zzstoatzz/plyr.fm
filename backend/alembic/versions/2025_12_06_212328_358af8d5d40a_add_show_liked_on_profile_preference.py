"""add show_liked_on_profile preference

Revision ID: 358af8d5d40a
Revises: effe28dd977b
Create Date: 2025-12-06 21:23:28.804641

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "358af8d5d40a"
down_revision: str | None = "effe28dd977b"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Add show_liked_on_profile column to user_preferences."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "show_liked_on_profile",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove show_liked_on_profile column from user_preferences."""
    op.drop_column("user_preferences", "show_liked_on_profile")

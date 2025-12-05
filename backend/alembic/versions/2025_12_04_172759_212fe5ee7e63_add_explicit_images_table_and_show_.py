"""add explicit_images table and show_explicit_artwork preference

Revision ID: 212fe5ee7e63
Revises: d4e6457a0fe3
Create Date: 2025-12-04 17:27:59.667270

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "212fe5ee7e63"
down_revision: str | Sequence[str] | None = "d4e6457a0fe3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # create explicit_images table
    op.create_table(
        "explicit_images",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("image_id", sa.String, nullable=True, index=True),
        sa.Column("url", sa.Text, nullable=True, index=True),
        sa.Column("reason", sa.String, nullable=True),
        sa.Column(
            "flagged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("flagged_by", sa.String, nullable=True),
    )

    # add show_explicit_artwork preference
    op.add_column(
        "user_preferences",
        sa.Column(
            "show_explicit_artwork",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "show_explicit_artwork")
    op.drop_table("explicit_images")

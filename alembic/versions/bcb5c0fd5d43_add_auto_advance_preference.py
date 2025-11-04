"""add auto advance preference column

Revision ID: bcb5c0fd5d43
Revises: 9e8c7aa5b945
Create Date: 2025-11-04 04:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bcb5c0fd5d43"
down_revision: str | Sequence[str] | None = "9e8c7aa5b945"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "auto_advance",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.execute(
        "UPDATE user_preferences SET auto_advance = true WHERE auto_advance IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("user_preferences", "auto_advance")

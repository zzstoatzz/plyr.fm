"""merge queue and auto_advance migrations

Revision ID: 008ffaa79bea
Revises: 5684967eb462, bcb5c0fd5d43
Create Date: 2025-11-04 00:27:13.544390

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "008ffaa79bea"
down_revision: str | Sequence[str] | None = ("5684967eb462", "bcb5c0fd5d43")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""


def downgrade() -> None:
    """Downgrade schema."""

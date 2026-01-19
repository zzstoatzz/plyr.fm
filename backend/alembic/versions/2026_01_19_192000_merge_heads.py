"""merge migration heads

Revision ID: merge_883e927_732d7de
Revises: 883e927fdd76, 732d7de222b0
Create Date: 2026-01-19 19:20:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "merge_883e927_732d7de"
down_revision: tuple[str, str] = ("883e927fdd76", "732d7de222b0")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Merge migration - no schema changes."""


def downgrade() -> None:
    """Merge migration - no schema changes."""

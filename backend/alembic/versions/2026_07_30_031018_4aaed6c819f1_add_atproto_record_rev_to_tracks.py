"""add atproto_record_rev to tracks

Revision ID: 4aaed6c819f1
Revises: 82a75e0ecf9f
Create Date: 2026-07-30 03:10:18.194959

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4aaed6c819f1"
down_revision: str | Sequence[str] | None = "82a75e0ecf9f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("tracks", sa.Column("atproto_record_rev", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "atproto_record_rev")

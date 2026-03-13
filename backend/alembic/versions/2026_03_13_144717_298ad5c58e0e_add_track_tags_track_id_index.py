"""add track_tags track_id index

Revision ID: 298ad5c58e0e
Revises: 5007f35f03d9
Create Date: 2026-03-13 14:47:17.303915

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "298ad5c58e0e"
down_revision: str | Sequence[str] | None = "5007f35f03d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index("ix_track_tags_track_id", "track_tags", ["track_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_track_tags_track_id", table_name="track_tags")

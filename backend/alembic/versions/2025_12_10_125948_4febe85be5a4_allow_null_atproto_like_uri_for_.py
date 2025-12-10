"""allow null atproto_like_uri for optimistic writes

Revision ID: 4febe85be5a4
Revises: a6069b752a90
Create Date: 2025-12-10 12:59:48.646844

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4febe85be5a4"
down_revision: str | Sequence[str] | None = "a6069b752a90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make atproto_like_uri nullable for background PDS writes."""
    op.alter_column(
        "track_likes",
        "atproto_like_uri",
        existing_type=sa.VARCHAR(),
        nullable=True,
    )


def downgrade() -> None:
    """Revert atproto_like_uri to non-nullable."""
    # first, delete any rows with NULL atproto_like_uri
    op.execute("DELETE FROM track_likes WHERE atproto_like_uri IS NULL")
    op.alter_column(
        "track_likes",
        "atproto_like_uri",
        existing_type=sa.VARCHAR(),
        nullable=False,
    )

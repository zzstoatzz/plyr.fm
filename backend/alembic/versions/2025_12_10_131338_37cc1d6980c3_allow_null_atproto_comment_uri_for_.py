"""allow null atproto_comment_uri for optimistic writes

Revision ID: 37cc1d6980c3
Revises: 4febe85be5a4
Create Date: 2025-12-10 13:13:38.218675

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "37cc1d6980c3"
down_revision: str | Sequence[str] | None = "4febe85be5a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make atproto_comment_uri nullable for background PDS writes."""
    op.alter_column(
        "track_comments",
        "atproto_comment_uri",
        existing_type=sa.VARCHAR(),
        nullable=True,
    )


def downgrade() -> None:
    """Revert atproto_comment_uri to non-nullable."""
    # first, delete any rows with NULL atproto_comment_uri
    op.execute("DELETE FROM track_comments WHERE atproto_comment_uri IS NULL")
    op.alter_column(
        "track_comments",
        "atproto_comment_uri",
        existing_type=sa.VARCHAR(),
        nullable=False,
    )

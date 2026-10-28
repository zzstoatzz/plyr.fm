"""add protected audio space references

Revision ID: 3d875a858a31
Revises: 8c9f4bcf1ec3
Create Date: 2026-10-28 12:28:05.018651

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3d875a858a31"
down_revision: str | Sequence[str] | None = "8c9f4bcf1ec3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    for table in ("tracks", "track_revisions"):
        op.add_column(
            table,
            sa.Column(
                "protected_audio", postgresql.JSONB(none_as_null=True), nullable=True
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table in ("tracks", "track_revisions"):
        op.drop_column(table, "protected_audio")

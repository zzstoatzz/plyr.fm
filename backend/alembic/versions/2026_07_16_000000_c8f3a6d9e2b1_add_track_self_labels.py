"""add track self labels

Revision ID: c8f3a6d9e2b1
Revises: b7e2c4d8a1f6
Create Date: 2026-07-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8f3a6d9e2b1"
down_revision: str | Sequence[str] | None = "b7e2c4d8a1f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Store creator-published ATProto label values separately from operators."""
    op.add_column(
        "tracks",
        sa.Column(
            "self_labels",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Remove indexed creator self-label values."""
    op.drop_column("tracks", "self_labels")

"""add Zig relay cursors

Revision ID: 91d8c4e7a2b6
Revises: 7f1f760c57c1
Create Date: 2026-08-08 23:50:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "91d8c4e7a2b6"
down_revision: str | Sequence[str] | None = "7f1f760c57c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Persist accepted relay watermarks independently of repository state."""
    op.create_table(
        "relay_cursors",
        sa.Column("source", sa.Text(), primary_key=True),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("updated_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "length(source) BETWEEN 1 AND 255",
            name="ck_relay_cursors_source",
        ),
        sa.CheckConstraint("seq >= 0", name="ck_relay_cursors_seq"),
        sa.CheckConstraint(
            "updated_at_us >= 0",
            name="ck_relay_cursors_updated_at",
        ),
        schema="plyr_index",
    )


def downgrade() -> None:
    """Remove relay resume state without touching verified repo heads."""
    op.drop_table("relay_cursors", schema="plyr_index")

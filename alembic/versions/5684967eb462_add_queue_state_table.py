"""add queue_state table

Revision ID: 5684967eb462
Revises: ec40ac6453bc
Create Date: 2025-11-03 18:13:14.807103

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5684967eb462"
down_revision: str | Sequence[str] | None = "ec40ac6453bc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # create queue_state table with revision tracking
    op.create_table(
        "queue_state",
        sa.Column("did", sa.String(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("did"),
    )

    # create indexes for efficient queries
    op.create_index(op.f("ix_queue_state_did"), "queue_state", ["did"], unique=True)
    op.create_index(op.f("ix_queue_state_updated_at"), "queue_state", ["updated_at"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_queue_state_updated_at"), table_name="queue_state")
    op.drop_index(op.f("ix_queue_state_did"), table_name="queue_state")
    op.drop_table("queue_state")

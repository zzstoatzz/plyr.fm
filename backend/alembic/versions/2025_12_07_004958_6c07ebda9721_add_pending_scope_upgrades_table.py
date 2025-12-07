"""add pending_scope_upgrades table

Revision ID: 6c07ebda9721
Revises: 89f7fd3db111
Create Date: 2025-12-07 00:49:58.146707

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6c07ebda9721"
down_revision: str | Sequence[str] | None = "89f7fd3db111"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "pending_scope_upgrades",
        sa.Column("state", sa.String(64), primary_key=True),
        sa.Column("did", sa.String(256), nullable=False, index=True),
        sa.Column("old_session_id", sa.String(64), nullable=False),
        sa.Column("requested_scopes", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_pending_scope_upgrades_state", "pending_scope_upgrades", ["state"]
    )
    op.create_index(
        "ix_pending_scope_upgrades_created_at", "pending_scope_upgrades", ["created_at"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_pending_scope_upgrades_created_at", table_name="pending_scope_upgrades"
    )
    op.drop_index(
        "ix_pending_scope_upgrades_state", table_name="pending_scope_upgrades"
    )
    op.drop_table("pending_scope_upgrades")

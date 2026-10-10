"""Add native app sign-in: pending app logins and PKCE-bound exchange tokens.

Revision ID: b6e2f4a1c9d3
Revises: 311b4f106c90
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b6e2f4a1c9d3"
down_revision: str | Sequence[str] | None = "311b4f106c90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pending_app_logins",
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column("code_challenge", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("state"),
    )
    op.create_index(
        op.f("ix_pending_app_logins_state"), "pending_app_logins", ["state"]
    )
    op.create_index(
        op.f("ix_pending_app_logins_created_at"), "pending_app_logins", ["created_at"]
    )
    op.add_column(
        "exchange_tokens",
        sa.Column("code_challenge", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("exchange_tokens", "code_challenge")
    op.drop_index(
        op.f("ix_pending_app_logins_created_at"), table_name="pending_app_logins"
    )
    op.drop_index(op.f("ix_pending_app_logins_state"), table_name="pending_app_logins")
    op.drop_table("pending_app_logins")

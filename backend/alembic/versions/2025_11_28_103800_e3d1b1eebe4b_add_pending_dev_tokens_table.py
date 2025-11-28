"""add pending_dev_tokens table and exchange_tokens.is_dev_token

Revision ID: e3d1b1eebe4b
Revises: 9851b6850eb1
Create Date: 2025-11-28 10:38:00.882501
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e3d1b1eebe4b"
down_revision: str | Sequence[str] | None = "9851b6850eb1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create pending_dev_tokens table and add is_dev_token to exchange_tokens."""
    op.create_table(
        "pending_dev_tokens",
        sa.Column("state", sa.String(64), primary_key=True, index=True),
        sa.Column("did", sa.String(256), nullable=False, index=True),
        sa.Column("token_name", sa.String(100), nullable=True),
        sa.Column("expires_in_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            index=True,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now() + interval '10 minutes'"),
        ),
    )

    # add is_dev_token column to exchange_tokens to prevent cookie override
    op.add_column(
        "exchange_tokens",
        sa.Column(
            "is_dev_token",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    """Drop pending_dev_tokens table and remove is_dev_token from exchange_tokens."""
    op.drop_column("exchange_tokens", "is_dev_token")
    op.drop_table("pending_dev_tokens")

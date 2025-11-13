"""add exchange_tokens table for secure OAuth callback

Revision ID: ec40ac6453bc
Revises: 846cc6b867b8
Create Date: 2025-11-03 10:15:32.856846

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "ec40ac6453bc"
down_revision: str | Sequence[str] | None = "846cc6b867b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    import sqlalchemy as sa

    from alembic import op

    op.create_table(
        "exchange_tokens",
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("session_id", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "used", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.PrimaryKeyConstraint("token"),
    )
    op.create_index(
        op.f("ix_exchange_tokens_token"), "exchange_tokens", ["token"], unique=False
    )
    op.create_index(
        op.f("ix_exchange_tokens_session_id"),
        "exchange_tokens",
        ["session_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    from alembic import op

    op.drop_index(op.f("ix_exchange_tokens_session_id"), table_name="exchange_tokens")
    op.drop_index(op.f("ix_exchange_tokens_token"), table_name="exchange_tokens")
    op.drop_table("exchange_tokens")

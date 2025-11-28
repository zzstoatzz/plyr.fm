"""add api_keys table

Revision ID: ef7e33fb70b1
Revises: e9acf24e6885
Create Date: 2025-11-27 20:51:03.551587

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ef7e33fb70b1"
down_revision: str | Sequence[str] | None = "e9acf24e6885"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_did",
            sa.String(),
            sa.ForeignKey("artists.did", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key_prefix", sa.String(24), nullable=False),
        sa.Column("key_hash", sa.String(128), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("key_type", sa.String(12), nullable=False, server_default="secret"),
        sa.Column("environment", sa.String(12), nullable=False, server_default="live"),
        sa.Column("scopes", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_from_ip", postgresql.INET(), nullable=True),
        sa.Column("last_used_from_ip", postgresql.INET(), nullable=True),
    )

    op.create_index("ix_api_keys_owner_did", "api_keys", ["owner_did"])
    op.create_index("ix_api_keys_key_prefix", "api_keys", ["key_prefix"])
    op.create_index(
        "idx_api_keys_active",
        "api_keys",
        ["owner_did"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("api_keys")

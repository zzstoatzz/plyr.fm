"""add_feature_flags_table

Revision ID: 1a94c1ea171d
Revises: add_share_links_tables
Create Date: 2026-01-24 23:52:03.235872

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1a94c1ea171d"
down_revision: str | Sequence[str] | None = "add_share_links_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "feature_flags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_did", sa.String(), nullable=False),
        sa.Column("flag", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_did"], ["artists.did"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_did", "flag", name="uq_user_flag"),
    )
    op.create_index(
        op.f("ix_feature_flags_user_did"), "feature_flags", ["user_did"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_feature_flags_user_did"), table_name="feature_flags")
    op.drop_table("feature_flags")

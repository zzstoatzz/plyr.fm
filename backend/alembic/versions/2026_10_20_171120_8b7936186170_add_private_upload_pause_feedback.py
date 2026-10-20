"""add private upload pause feedback

Revision ID: 8b7936186170
Revises: 311b4f106c90
Create Date: 2026-10-20 17:11:20.441632

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8b7936186170"
down_revision: str | Sequence[str] | None = "311b4f106c90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "upload_feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("did", sa.String(), nullable=False),
        sa.Column("handle", sa.String(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("upload_feedback")

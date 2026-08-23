"""drop private_media_members

membership is never stored: the space authority answers per credential mint,
and plyr holds only that answer for the credential's lifetime (redis).

Revision ID: a81c2d9e4f07
Revises: f3a9c1d27b4e
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a81c2d9e4f07"
down_revision: str | Sequence[str] | None = "f3a9c1d27b4e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(
        "ix_private_media_members_member_did", table_name="private_media_members"
    )
    op.drop_table("private_media_members")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        "private_media_members",
        sa.Column("artist_did", sa.String(), nullable=False),
        sa.Column("member_did", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("artist_did", "member_did"),
    )
    op.create_index(
        "ix_private_media_members_member_did",
        "private_media_members",
        ["member_did"],
    )

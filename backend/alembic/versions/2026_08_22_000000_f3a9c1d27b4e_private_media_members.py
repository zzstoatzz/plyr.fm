"""private media members

plyr.fm's mirror of each artist's simplespace member list, so visibility
checks can answer in SQL. the PDS list is the source of truth.

Revision ID: f3a9c1d27b4e
Revises: e7a4d1b93fc5
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a9c1d27b4e"
down_revision: str | Sequence[str] | None = "e7a4d1b93fc5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
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


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_private_media_members_member_did", table_name="private_media_members"
    )
    op.drop_table("private_media_members")

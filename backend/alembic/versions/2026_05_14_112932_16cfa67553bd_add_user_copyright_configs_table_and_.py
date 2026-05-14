"""add user_copyright_configs table and copyright uri columns on tracks

Revision ID: 16cfa67553bd
Revises: 4e4697761ec6
Create Date: 2026-05-14 11:29:32.850973

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "16cfa67553bd"
down_revision: str | Sequence[str] | None = "4e4697761ec6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_copyright_configs",
        sa.Column("user_did", sa.String(length=256), nullable=False),
        sa.Column("paradigm", sa.String(length=64), nullable=False),
        sa.Column("config_uri", sa.String(length=512), nullable=True),
        sa.Column("paradigm_data", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_did"),
    )
    op.add_column("tracks", sa.Column("copyright_song_uri", sa.String(), nullable=True))
    op.add_column(
        "tracks", sa.Column("copyright_recording_uri", sa.String(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "copyright_recording_uri")
    op.drop_column("tracks", "copyright_song_uri")
    op.drop_table("user_copyright_configs")

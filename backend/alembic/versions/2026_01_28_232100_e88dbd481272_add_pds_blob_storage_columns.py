"""add pds blob storage columns

Revision ID: e88dbd481272
Revises: 38dd0d1af1b7
Create Date: 2026-01-28 23:21:00.640289

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e88dbd481272"
down_revision: str | Sequence[str] | None = "38dd0d1af1b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "tracks",
        sa.Column("audio_storage", sa.String(), server_default="r2", nullable=False),
    )
    op.add_column("tracks", sa.Column("pds_blob_cid", sa.String(), nullable=True))
    op.add_column("tracks", sa.Column("pds_blob_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "pds_blob_size")
    op.drop_column("tracks", "pds_blob_cid")
    op.drop_column("tracks", "audio_storage")

"""remove unique constraint from tracks file_id

Revision ID: ba46ea4ba64e
Revises: 008ffaa79bea
Create Date: 2025-11-09 02:23:52.593507

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ba46ea4ba64e"
down_revision: str | Sequence[str] | None = "008ffaa79bea"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # drop unique constraint on file_id
    op.drop_constraint("tracks_file_id_key", "tracks", type_="unique")

    # add non-unique index for query performance
    op.create_index("ix_tracks_file_id", "tracks", ["file_id"])


def downgrade() -> None:
    """Downgrade schema."""
    # remove index
    op.drop_index("ix_tracks_file_id", "tracks")

    # re-add unique constraint
    op.create_unique_constraint("tracks_file_id_key", "tracks", ["file_id"])

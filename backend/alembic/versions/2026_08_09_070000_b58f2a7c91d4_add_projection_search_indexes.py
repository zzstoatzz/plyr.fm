"""add projection search indexes

Revision ID: b58f2a7c91d4
Revises: a47e19c83b20
Create Date: 2026-08-09 07:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "b58f2a7c91d4"
down_revision: str | Sequence[str] | None = "a47e19c83b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Index authored search text without creating another content authority."""
    op.execute(
        "CREATE INDEX ix_plyr_index_track_records_title_trgm "
        "ON plyr_index.track_records USING gin (title gin_trgm_ops) "
        "WHERE NOT deleted"
    )
    op.execute(
        "CREATE INDEX ix_plyr_index_list_records_name_trgm "
        "ON plyr_index.list_records USING gin (name gin_trgm_ops) "
        "WHERE NOT deleted AND name IS NOT NULL"
    )


def downgrade() -> None:
    """Remove the rebuildable search acceleration structures."""
    op.drop_index(
        "ix_plyr_index_list_records_name_trgm",
        table_name="list_records",
        schema="plyr_index",
    )
    op.drop_index(
        "ix_plyr_index_track_records_title_trgm",
        table_name="track_records",
        schema="plyr_index",
    )

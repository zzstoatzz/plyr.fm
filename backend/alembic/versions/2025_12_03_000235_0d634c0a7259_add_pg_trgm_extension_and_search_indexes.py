"""add pg_trgm extension and search indexes

Revision ID: 0d634c0a7259
Revises: f60f46fb6014
Create Date: 2025-12-03 00:02:35.608832

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d634c0a7259"
down_revision: str | Sequence[str] | None = "f60f46fb6014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """enable pg_trgm and create search indexes."""
    # enable pg_trgm extension for fuzzy/similarity search
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # trigram indexes for fuzzy matching
    # note: not using CONCURRENTLY since tables are small (<100 rows)
    # tracks: search by title
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tracks_title_trgm "
        "ON tracks USING GIN (title gin_trgm_ops)"
    )

    # artists: search by handle and display_name
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_artists_handle_trgm "
        "ON artists USING GIN (handle gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_artists_display_name_trgm "
        "ON artists USING GIN (display_name gin_trgm_ops)"
    )

    # albums: search by title
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_albums_title_trgm "
        "ON albums USING GIN (title gin_trgm_ops)"
    )

    # tags: search by name
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tags_name_trgm "
        "ON tags USING GIN (name gin_trgm_ops)"
    )


def downgrade() -> None:
    """remove search indexes (keep extension)."""
    op.execute("DROP INDEX IF EXISTS ix_tags_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_albums_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_artists_display_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_artists_handle_trgm")
    op.execute("DROP INDEX IF EXISTS ix_tracks_title_trgm")
    # note: not dropping pg_trgm extension as other things may depend on it

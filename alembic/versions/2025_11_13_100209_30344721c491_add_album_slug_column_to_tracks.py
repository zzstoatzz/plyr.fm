"""add album_slug column to tracks

Revision ID: 30344721c491
Revises: 07c4ad820a27
Create Date: 2025-11-13 10:02:09.200379

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "30344721c491"
down_revision: str | Sequence[str] | None = "07c4ad820a27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """add album_slug column and index, backfill from existing album data."""
    # add column (nullable initially for backfill)
    op.add_column("tracks", sa.Column("album_slug", sa.String(), nullable=True))

    # backfill album_slug from extra->album
    # using raw SQL to access JSONB and replicate slugify logic
    op.execute("""
        UPDATE tracks
        SET album_slug = lower(
            regexp_replace(
                regexp_replace(
                    regexp_replace(tracks.extra->>'album', '[^a-zA-Z0-9\\s-]', '', 'g'),
                    '\\s+', '-', 'g'
                ),
                '-+', '-', 'g'
            )
        )
        WHERE tracks.extra->>'album' IS NOT NULL
        AND tracks.extra->>'album' != ''
    """)

    # add index for fast album lookups
    op.create_index(
        op.f("ix_tracks_album_slug"), "tracks", ["album_slug"], unique=False
    )


def downgrade() -> None:
    """remove album_slug column and index."""
    op.drop_index(op.f("ix_tracks_album_slug"), table_name="tracks")
    op.drop_column("tracks", "album_slug")

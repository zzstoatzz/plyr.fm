"""add albums table and link tracks to albums

Revision ID: 7f3d3a0f6c1a
Revises: 30344721c491
Create Date: 2025-11-13 21:00:00.000000

"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7f3d3a0f6c1a"
down_revision: str | None = "30344721c491"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """create albums table and backfill album ids on tracks."""
    op.create_table(
        "albums",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("artist_did", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("image_id", sa.String(), nullable=True),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("atproto_record_uri", sa.String(), nullable=True),
        sa.Column("atproto_record_cid", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["artist_did"], ["artists.did"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artist_did", "slug", name="uq_albums_artist_slug"),
    )
    op.create_index(
        op.f("ix_albums_artist_did"), "albums", ["artist_did"], unique=False
    )

    op.add_column("tracks", sa.Column("album_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "tracks_album_id_fkey", "tracks", "albums", ["album_id"], ["id"]
    )
    op.create_index(op.f("ix_tracks_album_id"), "tracks", ["album_id"], unique=False)

    # backfill albums from existing track metadata
    conn = op.get_bind()

    albums_table = sa.table(
        "albums",
        sa.column("id", sa.String),
        sa.column("artist_did", sa.String),
        sa.column("slug", sa.String),
        sa.column("title", sa.String),
        sa.column("description", sa.String),
        sa.column("image_id", sa.String),
        sa.column("image_url", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )

    rows = conn.execute(
        sa.text(
            """
            SELECT DISTINCT ON (artist_did, album_slug)
                id,
                artist_did,
                album_slug,
                extra,
                image_id,
                image_url,
                created_at
            FROM tracks
            WHERE album_slug IS NOT NULL
            ORDER BY artist_did, album_slug, created_at ASC
            """
        )
    ).fetchall()

    now = datetime.now(UTC)
    for row in rows:
        album_slug = row.album_slug
        if not album_slug:
            continue

        album_title = None
        if row.extra and isinstance(row.extra, dict):
            album_title = row.extra.get("album")
        if not album_title:
            album_title = album_slug

        album_id = str(uuid.uuid4())
        conn.execute(
            albums_table.insert().values(
                id=album_id,
                artist_did=row.artist_did,
                slug=album_slug,
                title=album_title,
                description=None,
                image_id=row.image_id,
                image_url=row.image_url,
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(
            sa.text(
                "UPDATE tracks SET album_id = :album_id WHERE artist_did = :artist_did AND album_slug = :album_slug"
            ),
            {
                "album_id": album_id,
                "artist_did": row.artist_did,
                "album_slug": album_slug,
            },
        )


def downgrade() -> None:
    """drop album references."""
    op.drop_constraint("tracks_album_id_fkey", "tracks", type_="foreignkey")
    op.drop_index(op.f("ix_tracks_album_id"), table_name="tracks")
    op.drop_column("tracks", "album_id")
    op.drop_index(op.f("ix_albums_artist_did"), table_name="albums")
    op.drop_table("albums")

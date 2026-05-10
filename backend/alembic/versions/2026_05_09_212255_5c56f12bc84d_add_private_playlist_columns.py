"""add private playlist columns

Revision ID: 5c56f12bc84d
Revises: 90bfeb4a0dd3
Create Date: 2026-05-09 21:22:55.836881

adds `is_private` (default false) and `items_json` (nullable jsonb) to
the playlists table, and makes `atproto_record_uri` / `atproto_record_cid`
nullable so private playlists — which never get pushed to a PDS — can
sit in the same table.

private playlists are app-layer privacy today; when atproto's
permissioned-data substrate ships, this feature can migrate. see #1384.
existing rows are public (`is_private=false`) and have non-null URIs.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c56f12bc84d"
down_revision: str | Sequence[str] | None = "90bfeb4a0dd3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "playlists",
        sa.Column("is_private", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "playlists",
        sa.Column("items_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.alter_column(
        "playlists",
        "atproto_record_uri",
        existing_type=sa.VARCHAR(),
        nullable=True,
    )
    op.alter_column(
        "playlists",
        "atproto_record_cid",
        existing_type=sa.VARCHAR(),
        nullable=True,
    )
    op.create_index(
        op.f("ix_playlists_is_private"), "playlists", ["is_private"], unique=False
    )


def downgrade() -> None:
    """Downgrade.

    private playlists hold NULL in `atproto_record_uri` / `atproto_record_cid`,
    so blindly restoring those columns to NOT NULL fails as soon as any
    private playlist exists. running this downgrade after that point would
    silently lose the private rows if we hard-deleted them, so make the
    intent explicit instead: operator chooses how to handle the data.

    to revert manually:
        DELETE FROM playlists WHERE is_private = true;
        -- then re-run `alembic downgrade` and the ALTER NOT NULL succeeds
    """
    bind = op.get_bind()
    private_count = bind.execute(
        sa.text("SELECT count(*) FROM playlists WHERE is_private = true")
    ).scalar_one()
    if private_count:
        raise RuntimeError(
            f"cannot downgrade: {private_count} private playlist(s) exist with "
            "NULL atproto_record_uri. delete or convert them first: "
            "DELETE FROM playlists WHERE is_private = true;"
        )

    op.drop_index(op.f("ix_playlists_is_private"), table_name="playlists")
    op.alter_column(
        "playlists",
        "atproto_record_cid",
        existing_type=sa.VARCHAR(),
        nullable=False,
    )
    op.alter_column(
        "playlists",
        "atproto_record_uri",
        existing_type=sa.VARCHAR(),
        nullable=False,
    )
    op.drop_column("playlists", "items_json")
    op.drop_column("playlists", "is_private")

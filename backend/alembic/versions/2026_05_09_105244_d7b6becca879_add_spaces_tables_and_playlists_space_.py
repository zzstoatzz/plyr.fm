"""add spaces tables and playlists.space_uri

Revision ID: d7b6becca879
Revises: 90bfeb4a0dd3
Create Date: 2026-05-09 10:52:44.890962

backend scaffolding aligned to atproto's permissioned-data ("spaces") spec
in https://github.com/bluesky-social/atproto/compare/permissioned-data .

introduces three tables (`spaces`, `space_members`, `space_records`) that
mirror the protocol's data model. for now they back features like private
playlists at the app layer; when atproto permissioned data ships, the
storage layer swaps to PDS XRPC calls without changing the abstraction.

`playlists.atproto_record_uri` and `atproto_record_cid` become nullable —
private playlists live in a permissioned space (`space_uri` set) instead
of the user's public PDS repo. existing rows have non-null values and are
unaffected.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7b6becca879"
down_revision: str | Sequence[str] | None = "90bfeb4a0dd3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "spaces",
        sa.Column("uri", sa.String(), nullable=False),
        sa.Column("owner_did", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("skey", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_did"], ["artists.did"]),
        sa.PrimaryKeyConstraint("uri"),
        sa.UniqueConstraint(
            "owner_did", "type", "skey", name="uq_spaces_owner_type_skey"
        ),
    )
    op.create_index(op.f("ix_spaces_owner_did"), "spaces", ["owner_did"], unique=False)
    op.create_index("ix_spaces_type", "spaces", ["type"], unique=False)

    op.create_table(
        "space_members",
        sa.Column("space_uri", sa.String(), nullable=False),
        sa.Column("did", sa.String(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["space_uri"], ["spaces.uri"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("space_uri", "did"),
    )

    op.create_table(
        "space_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("space_uri", sa.String(), nullable=False),
        sa.Column("writer_did", sa.String(), nullable=False),
        sa.Column("collection", sa.String(), nullable=False),
        sa.Column("rkey", sa.String(), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["space_uri"], ["spaces.uri"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "space_uri",
            "collection",
            "rkey",
            name="uq_space_records_uri_collection_rkey",
        ),
    )
    op.create_index(
        "ix_space_records_space_collection",
        "space_records",
        ["space_uri", "collection"],
        unique=False,
    )

    op.add_column("playlists", sa.Column("space_uri", sa.String(), nullable=True))
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
        op.f("ix_playlists_space_uri"), "playlists", ["space_uri"], unique=False
    )
    op.create_foreign_key(
        "fk_playlists_space_uri",
        "playlists",
        "spaces",
        ["space_uri"],
        ["uri"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_playlists_space_uri", "playlists", type_="foreignkey")
    op.drop_index(op.f("ix_playlists_space_uri"), table_name="playlists")
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
    op.drop_column("playlists", "space_uri")

    op.drop_index("ix_space_records_space_collection", table_name="space_records")
    op.drop_table("space_records")
    op.drop_table("space_members")
    op.drop_index("ix_spaces_type", table_name="spaces")
    op.drop_index(op.f("ix_spaces_owner_did"), table_name="spaces")
    op.drop_table("spaces")

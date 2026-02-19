"""add jams tables

Revision ID: f4ff6ce7d78b
Revises: e88dbd481272
Create Date: 2026-02-19 00:12:58.334693

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4ff6ce7d78b"
down_revision: str | Sequence[str] | None = "e88dbd481272"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "jams",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("code", sa.String(length=12), nullable=False),
        sa.Column("host_did", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("state", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["host_did"], ["artists.did"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_jams_code", "jams", ["code"], unique=True)
    op.create_index("ix_jams_host_did", "jams", ["host_did"], unique=False)
    op.create_index(
        "ix_jams_is_active",
        "jams",
        ["is_active"],
        unique=False,
        postgresql_where=sa.text("is_active IS true"),
    )
    op.create_table(
        "jam_participants",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("jam_id", sa.String(), nullable=False),
        sa.Column("did", sa.String(), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["did"], ["artists.did"]),
        sa.ForeignKeyConstraint(["jam_id"], ["jams.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_jam_participants_did_active",
        "jam_participants",
        ["did"],
        unique=False,
        postgresql_where=sa.text("left_at IS NULL"),
    )
    op.create_index(
        "ix_jam_participants_jam_id",
        "jam_participants",
        ["jam_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_jam_participants_jam_id", table_name="jam_participants")
    op.drop_index(
        "ix_jam_participants_did_active",
        table_name="jam_participants",
        postgresql_where=sa.text("left_at IS NULL"),
    )
    op.drop_table("jam_participants")
    op.drop_index(
        "ix_jams_is_active",
        table_name="jams",
        postgresql_where=sa.text("is_active IS true"),
    )
    op.drop_index("ix_jams_host_did", table_name="jams")
    op.drop_index("ix_jams_code", table_name="jams")
    op.drop_table("jams")

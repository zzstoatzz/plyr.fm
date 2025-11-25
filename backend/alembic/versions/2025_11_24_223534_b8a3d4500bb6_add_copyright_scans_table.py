"""add copyright_scans table

Revision ID: b8a3d4500bb6
Revises: 63b5345e1707
Create Date: 2025-11-24 22:35:34.504294

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8a3d4500bb6"
down_revision: str | Sequence[str] | None = "63b5345e1707"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "copyright_scans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_flagged", sa.Boolean(), nullable=False),
        sa.Column("highest_score", sa.Integer(), nullable=False),
        sa.Column(
            "matches",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "raw_response",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("resolution", sa.String(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(), nullable=True),
        sa.Column("review_notes", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_copyright_scans_flagged", "copyright_scans", ["is_flagged"], unique=False
    )
    op.create_index(
        "idx_copyright_scans_scanned_at",
        "copyright_scans",
        ["scanned_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_copyright_scans_id"), "copyright_scans", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_copyright_scans_track_id"),
        "copyright_scans",
        ["track_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_copyright_scans_track_id"), table_name="copyright_scans")
    op.drop_index(op.f("ix_copyright_scans_id"), table_name="copyright_scans")
    op.drop_index("idx_copyright_scans_scanned_at", table_name="copyright_scans")
    op.drop_index("idx_copyright_scans_flagged", table_name="copyright_scans")
    op.drop_table("copyright_scans")

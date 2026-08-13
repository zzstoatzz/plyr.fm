"""index exact-subject verified likes

Revision ID: f93c4e1a6b05
Revises: e82b3d0f5a94
Create Date: 2026-08-10 02:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f93c4e1a6b05"
down_revision: str | Sequence[str] | None = "e82b3d0f5a94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Match strong-reference reads and their keyset order."""
    op.drop_index(
        "ix_like_records_subject_live",
        table_name="like_records",
        schema="plyr_index",
    )
    op.create_index(
        "ix_like_records_subject_live",
        "like_records",
        [
            "subject_uri",
            "subject_cid",
            sa.text("record_created_at DESC"),
            sa.text("record_uri DESC"),
        ],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )


def downgrade() -> None:
    """Restore the original URI-only projection index."""
    op.drop_index(
        "ix_like_records_subject_live",
        table_name="like_records",
        schema="plyr_index",
    )
    op.create_index(
        "ix_like_records_subject_live",
        "like_records",
        ["subject_uri"],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT deleted"),
    )

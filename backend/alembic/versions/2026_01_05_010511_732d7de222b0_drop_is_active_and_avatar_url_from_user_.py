"""drop is_active and avatar_url from user_sessions

Revision ID: 732d7de222b0
Revises: 5d2522e9f7e9
Create Date: 2026-01-05 01:05:11.606841

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "732d7de222b0"
down_revision: str | Sequence[str] | None = "5d2522e9f7e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _column_exists(table: str, column: str) -> bool:
    """check if column exists in table."""
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    """Remove unused session columns if they exist.

    These columns were added during development but removed before merge.
    On fresh databases they won't exist, on dev they need to be dropped.
    """
    if _column_exists("user_sessions", "is_active"):
        op.drop_column("user_sessions", "is_active")
    if _column_exists("user_sessions", "avatar_url"):
        op.drop_column("user_sessions", "avatar_url")


def downgrade() -> None:
    """Restore session columns."""
    if not _column_exists("user_sessions", "avatar_url"):
        op.add_column(
            "user_sessions",
            sa.Column("avatar_url", sa.VARCHAR(length=500), nullable=True),
        )
    if not _column_exists("user_sessions", "is_active"):
        op.add_column(
            "user_sessions",
            sa.Column(
                "is_active",
                sa.BOOLEAN(),
                server_default=sa.text("true"),
                nullable=False,
            ),
        )

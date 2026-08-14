"""download_policy replaces allow_downloads

Revision ID: c4e2b8f51da1
Revises: b3d1a7e42c90
Create Date: 2026-08-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e2b8f51da1"
down_revision: str | Sequence[str] | None = "b3d1a7e42c90"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # NULL = auto (ask with a support link, open without)
    op.add_column(
        "user_preferences",
        sa.Column("download_policy", sa.String(), nullable=True),
    )
    op.execute(
        "UPDATE user_preferences SET download_policy = 'off' "
        "WHERE allow_downloads = false"
    )
    op.drop_column("user_preferences", "allow_downloads")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "user_preferences",
        sa.Column(
            "allow_downloads",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.execute(
        "UPDATE user_preferences SET allow_downloads = false "
        "WHERE download_policy = 'off'"
    )
    op.drop_column("user_preferences", "download_policy")

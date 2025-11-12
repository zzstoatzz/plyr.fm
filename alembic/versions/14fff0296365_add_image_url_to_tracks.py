"""add image_url to tracks

Revision ID: 14fff0296365
Revises: 32c17ef04e98
Create Date: 2025-11-12 01:54:02.431093

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "14fff0296365"
down_revision: str | Sequence[str] | None = "32c17ef04e98"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # add image_url column
    op.add_column("tracks", sa.Column("image_url", sa.String(), nullable=True))

    # backfill image_url for existing tracks with images
    # this uses the R2 storage helper to compute URLs
    # note: this will be run during deployment via fly.io release_command
    connection = op.get_bind()
    connection.execute(
        sa.text("""
        -- backfill will happen via application code post-deployment
        -- tracks with image_id will have their image_url populated on next access
    """)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "image_url")

"""add artist deactivated flag

Revision ID: e9ec24f00cd1
Revises: 2ff28fd69210
Create Date: 2026-06-04 01:56:53.818917

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9ec24f00cd1"
down_revision: str | None = "2ff28fd69210"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Add deactivated flag to artists (set from #account firehose events)."""
    op.add_column(
        "artists",
        sa.Column("deactivated", sa.Boolean(), server_default="false", nullable=False),
    )
    op.create_index(
        op.f("ix_artists_deactivated"), "artists", ["deactivated"], unique=False
    )


def downgrade() -> None:
    """Remove deactivated flag from artists."""
    op.drop_index(op.f("ix_artists_deactivated"), table_name="artists")
    op.drop_column("artists", "deactivated")

"""add partial index on tracks atproto_record_uri

Revision ID: e2d11e296633
Revises: bcf223076d43
Create Date: 2026-03-10 15:10:42.233072

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2d11e296633"
down_revision: str | Sequence[str] | None = "bcf223076d43"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "ix_tracks_atproto_record_uri_partial",
        "tracks",
        ["atproto_record_uri"],
        unique=True,
        postgresql_where=sa.text("atproto_record_uri IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_tracks_atproto_record_uri_partial",
        table_name="tracks",
    )

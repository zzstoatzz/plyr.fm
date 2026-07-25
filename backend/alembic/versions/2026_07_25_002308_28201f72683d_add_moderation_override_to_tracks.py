"""add moderation_override to tracks

Standing operator decision projected from the moderation event log: "allow"
surfaces a track despite a copyright label, "exclude" keeps it off shared
surfaces regardless of labels.

Hand-written. Autogenerate additionally proposed dropping the `api_keys` and
`pending_account_creations` tables, four trigram indexes, and
`tracks.album_slug` -- drift between the local dev database and the models,
not intended schema changes. Only the column belongs here.

Revision ID: 28201f72683d
Revises: 581366546d5c
Create Date: 2026-07-25 00:23:08.902215

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "28201f72683d"
down_revision: str | Sequence[str] | None = "581366546d5c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable override column. Null means no standing decision."""
    op.add_column(
        "tracks", sa.Column("moderation_override", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tracks", "moderation_override")

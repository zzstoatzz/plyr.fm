"""turn the album plylst link on by default

Revision ID: c7a1e5d2f9b4
Revises: b1050bb3430d
Create Date: 2026-11-02 20:18:00

the link shipped opt-in on 2026-10-30; almost every false is "never
touched", so every existing album is backfilled on along with the new
default. the link still hides itself unless every track is public.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7a1e5d2f9b4"
down_revision: str | Sequence[str] | None = "b1050bb3430d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("albums", "show_plylst", server_default=sa.true())
    op.execute("UPDATE albums SET show_plylst = true WHERE show_plylst = false")


def downgrade() -> None:
    """Downgrade schema (default only; the backfill is not reversed)."""
    op.alter_column("albums", "show_plylst", server_default=sa.false())

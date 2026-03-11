"""add track publish_state column

Revision ID: 5007f35f03d9
Revises: e2d11e296633
Create Date: 2026-03-10 21:42:34.157861

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5007f35f03d9"
down_revision: str | Sequence[str] | None = "e2d11e296633"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("tracks", sa.Column("publish_state", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("tracks", "publish_state")

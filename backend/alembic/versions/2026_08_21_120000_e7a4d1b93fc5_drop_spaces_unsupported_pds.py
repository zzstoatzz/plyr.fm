"""drop spaces_unsupported_pds from artists

Capability is read from the authorization server's advertised scopes, so there
is no failed-upgrade result to remember.

Revision ID: e7a4d1b93fc5
Revises: d5f3c9a62eb2
Create Date: 2026-08-21 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7a4d1b93fc5"
down_revision: str | Sequence[str] | None = "d5f3c9a62eb2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("artists", "spaces_unsupported_pds")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "artists", sa.Column("spaces_unsupported_pds", sa.String(), nullable=True)
    )

"""drop old artist columns

Revision ID: 547a171dfd11
Revises: aabe82c8f0fb
Create Date: 2025-11-01 14:18:45.810769

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '547a171dfd11'
down_revision: Union[str, Sequence[str], None] = 'aabe82c8f0fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # drop old artist columns that were replaced by artist_did foreign key
    op.drop_column('tracks', 'artist')
    op.drop_column('tracks', 'artist_handle')


def downgrade() -> None:
    """Downgrade schema."""
    # restore old artist columns
    op.add_column('tracks', sa.Column('artist_handle', sa.VARCHAR(), nullable=True))
    op.add_column('tracks', sa.Column('artist', sa.VARCHAR(), nullable=True))

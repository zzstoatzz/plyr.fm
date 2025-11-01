"""add features column to tracks

Revision ID: aabe82c8f0fb
Revises: 
Create Date: 2025-11-01 13:34:23.164178

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'aabe82c8f0fb'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # add features column for featured artists
    op.add_column('tracks', sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    # remove features column
    op.drop_column('tracks', 'features')

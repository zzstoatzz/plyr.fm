"""fix jsonb null in support_gate

Revision ID: 97e520a2e2fa
Revises: f4ff6ce7d78b
Create Date: 2026-02-26 08:50:17.916457

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "97e520a2e2fa"
down_revision: str | Sequence[str] | None = "f4ff6ce7d78b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Convert JSONB literal null to SQL NULL in support_gate and job result."""
    op.execute(
        sa.text(
            "UPDATE tracks SET support_gate = NULL WHERE support_gate::text = 'null'"
        )
    )
    op.execute(sa.text("UPDATE jobs SET result = NULL WHERE result::text = 'null'"))


def downgrade() -> None:
    """No-op — cannot distinguish original JSONB nulls from SQL NULLs."""

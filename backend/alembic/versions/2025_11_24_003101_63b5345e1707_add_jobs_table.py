"""add jobs table

Revision ID: 63b5345e1707
Revises: 7f3d3a0f6c1a
Create Date: 2025-11-24 00:31:01.929398

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "63b5345e1707"
down_revision: str | Sequence[str] | None = "7f3d3a0f6c1a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("owner_did", sa.String(), nullable=False),
        sa.Column("progress_pct", sa.Float(), nullable=False),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("phase", sa.String(), nullable=True),
        sa.Column(
            "result", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_jobs_owner", "jobs", ["owner_did"], unique=False)
    op.create_index("idx_jobs_updated_at", "jobs", ["updated_at"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("idx_jobs_updated_at", table_name="jobs")
    op.drop_index("idx_jobs_owner", table_name="jobs")
    op.drop_table("jobs")

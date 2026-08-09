"""add account availability projection

Revision ID: e6b08d3f2a71
Revises: d5a97c8f1e42
Create Date: 2026-08-09 00:50:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e6b08d3f2a71"
down_revision: str | Sequence[str] | None = "d5a97c8f1e42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create evidence-backed account availability independent of artist rows."""
    op.create_table(
        "account_availability",
        sa.Column("repo_did", sa.Text(), primary_key=True),
        sa.Column("available", sa.Boolean(), nullable=False),
        sa.Column("unavailable_reason", sa.Text(), nullable=True),
        sa.Column("evidence_source", sa.Text(), nullable=False),
        sa.Column("repository_rev", sa.Text(), nullable=True),
        sa.Column("commit_cid", sa.Text(), nullable=True),
        sa.Column("pds_origin", sa.Text(), nullable=True),
        sa.Column("observed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "available = (unavailable_reason IS NULL)",
            name="ck_account_availability_state_shape",
        ),
        sa.CheckConstraint(
            "evidence_source IN ('verified_repository', 'current_pds')",
            name="ck_account_availability_evidence_source",
        ),
        sa.CheckConstraint(
            "unavailable_reason IS NULL OR unavailable_reason IN "
            "('deactivated', 'deleted', 'takendown', 'suspended')",
            name="ck_account_availability_reason",
        ),
        sa.CheckConstraint(
            "(evidence_source = 'verified_repository' AND available "
            "AND repository_rev IS NOT NULL AND commit_cid IS NOT NULL "
            "AND pds_origin IS NULL) OR "
            "(evidence_source = 'current_pds' AND commit_cid IS NULL "
            "AND pds_origin IS NOT NULL)",
            name="ck_account_availability_evidence_shape",
        ),
        sa.CheckConstraint(
            "observed_at_us >= 0",
            name="ck_account_availability_observed_at",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_account_availability_unavailable",
        "account_availability",
        ["unavailable_reason"],
        unique=False,
        schema="plyr_index",
        postgresql_where=sa.text("NOT available"),
    )


def downgrade() -> None:
    """Remove only the rebuildable account-availability projection."""
    op.drop_index(
        "ix_account_availability_unavailable",
        table_name="account_availability",
        schema="plyr_index",
    )
    op.drop_table("account_availability", schema="plyr_index")

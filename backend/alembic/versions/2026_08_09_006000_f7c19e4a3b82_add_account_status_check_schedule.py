"""add account status check schedule

Revision ID: f7c19e4a3b82
Revises: e6b08d3f2a71
Create Date: 2026-08-09 01:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f7c19e4a3b82"
down_revision: str | Sequence[str] | None = "e6b08d3f2a71"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create durable, leased scheduling state separate from availability truth."""
    op.create_table(
        "account_status_checks",
        sa.Column("repo_did", sa.Text(), primary_key=True),
        sa.Column("next_attempt_at_us", sa.BigInteger(), nullable=False),
        sa.Column("hinted_at_us", sa.BigInteger(), nullable=False),
        sa.Column("lease_until_us", sa.BigInteger(), nullable=True),
        sa.Column("attempt_count", sa.BigInteger(), nullable=False),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        sa.Column("last_attempt_at_us", sa.BigInteger(), nullable=True),
        sa.Column("last_completed_at_us", sa.BigInteger(), nullable=True),
        sa.Column("last_success_at_us", sa.BigInteger(), nullable=True),
        sa.Column("last_response_authoritative", sa.Boolean(), nullable=True),
        sa.Column("last_outcome", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "next_attempt_at_us >= 0 AND hinted_at_us >= 0 "
            "AND (lease_until_us IS NULL OR lease_until_us >= 0) "
            "AND attempt_count >= 0 AND consecutive_failures >= 0",
            name="ck_account_status_checks_counters",
        ),
        sa.CheckConstraint(
            "(last_attempt_at_us IS NULL OR last_attempt_at_us >= 0) "
            "AND (last_completed_at_us IS NULL OR last_completed_at_us >= 0) "
            "AND (last_success_at_us IS NULL OR last_success_at_us >= 0)",
            name="ck_account_status_checks_timestamps",
        ),
        sa.CheckConstraint(
            "last_outcome IS NULL OR length(last_outcome) BETWEEN 1 AND 64",
            name="ck_account_status_checks_outcome",
        ),
        schema="plyr_index",
    )
    op.create_index(
        "ix_account_status_checks_due",
        "account_status_checks",
        ["next_attempt_at_us", "repo_did"],
        unique=False,
        schema="plyr_index",
    )


def downgrade() -> None:
    """Remove only current-PDS operational scheduling state."""
    op.drop_index(
        "ix_account_status_checks_due",
        table_name="account_status_checks",
        schema="plyr_index",
    )
    op.drop_table("account_status_checks", schema="plyr_index")

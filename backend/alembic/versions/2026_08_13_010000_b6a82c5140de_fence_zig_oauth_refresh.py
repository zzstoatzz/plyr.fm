"""fence zig oauth refresh

Revision ID: b6a82c5140de
Revises: f93c4e1a6b05
Create Date: 2026-08-13 01:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "b6a82c5140de"
down_revision: str | Sequence[str] | None = "f93c4e1a6b05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CANARY_ROLE = "plyr_zig_canary"


def _role_exists() -> bool:
    """Resolve the deployment role online; offline SQL targets next."""
    if context.is_offline_mode():
        return True
    return bool(
        op.get_bind().scalar(
            sa.text("SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = :role)"),
            {"role": CANARY_ROLE},
        )
    )


def upgrade() -> None:
    """Make rotating refresh-token use cluster-wide and crash-recoverable."""
    op.add_column(
        "sessions",
        sa.Column(
            "credentials_generation",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        schema="plyr_auth",
    )
    op.add_column(
        "sessions",
        sa.Column("refresh_owner", sa.Uuid(), nullable=True),
        schema="plyr_auth",
    )
    op.add_column(
        "sessions",
        sa.Column("refresh_lease_until", sa.DateTime(timezone=True), nullable=True),
        schema="plyr_auth",
    )
    op.create_check_constraint(
        "ck_sessions_refresh_lease_pair",
        "sessions",
        "(refresh_owner IS NULL) = (refresh_lease_until IS NULL)",
        schema="plyr_auth",
    )
    if _role_exists():
        op.execute(
            "GRANT UPDATE (sealed_credentials, scope, credentials_generation, "
            "refresh_owner, refresh_lease_until) ON plyr_auth.sessions "
            f"TO {CANARY_ROLE}"
        )


def downgrade() -> None:
    """Remove only the successor refresh coordination fields."""
    if _role_exists():
        op.execute(
            "REVOKE UPDATE (sealed_credentials, scope, credentials_generation, "
            "refresh_owner, refresh_lease_until) ON plyr_auth.sessions "
            f"FROM {CANARY_ROLE}"
        )
    op.drop_constraint(
        "ck_sessions_refresh_lease_pair",
        "sessions",
        schema="plyr_auth",
        type_="check",
    )
    op.drop_column("sessions", "refresh_lease_until", schema="plyr_auth")
    op.drop_column("sessions", "refresh_owner", schema="plyr_auth")
    op.drop_column("sessions", "credentials_generation", schema="plyr_auth")

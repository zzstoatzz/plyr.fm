"""grant zig canary projection reads

Revision ID: a47e19c83b20
Revises: f64b0e7d325a
Create Date: 2026-08-09 06:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "a47e19c83b20"
down_revision: str | Sequence[str] | None = "f64b0e7d325a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CANARY_ROLE = "plyr_zig_canary"


def _role_exists() -> bool:
    """Resolve the deployment role online; offline SQL targets staging."""
    if context.is_offline_mode():
        return True
    return bool(
        op.get_bind().scalar(
            sa.text("SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = :role)"),
            {"role": CANARY_ROLE},
        )
    )


def upgrade() -> None:
    """Permit the canary role to read this and future projection tables."""
    if not _role_exists():
        return
    op.execute(f"GRANT USAGE ON SCHEMA plyr_index TO {CANARY_ROLE}")
    op.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA plyr_index TO {CANARY_ROLE}")
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA plyr_index "
        f"GRANT SELECT ON TABLES TO {CANARY_ROLE}"
    )


def downgrade() -> None:
    """Remove projection reads and their future-table default."""
    if not _role_exists():
        return
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA plyr_index "
        f"REVOKE SELECT ON TABLES FROM {CANARY_ROLE}"
    )
    op.execute(f"REVOKE SELECT ON ALL TABLES IN SCHEMA plyr_index FROM {CANARY_ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA plyr_index FROM {CANARY_ROLE}")

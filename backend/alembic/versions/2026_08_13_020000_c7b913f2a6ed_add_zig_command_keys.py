"""add zig command keys

Revision ID: c7b913f2a6ed
Revises: b6a82c5140de
Create Date: 2026-08-13 02:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "c7b913f2a6ed"
down_revision: str | Sequence[str] | None = "b6a82c5140de"
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
    """Reserve replay-safe PDS record keys without storing appview content."""
    op.execute("CREATE SCHEMA plyr_command")
    op.create_table(
        "record_keys",
        sa.Column("actor_did", sa.Text(), nullable=False),
        sa.Column("collection", sa.Text(), nullable=False),
        sa.Column("operation_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("rkey", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column(
            "allocated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.PrimaryKeyConstraint(
            "actor_did",
            "collection",
            "operation_digest",
            name="pk_record_keys",
        ),
        sa.UniqueConstraint(
            "actor_did", "collection", "rkey", name="uq_record_keys_rkey"
        ),
        sa.CheckConstraint("actor_did LIKE 'did:%'", name="ck_record_keys_actor_did"),
        sa.CheckConstraint(
            "octet_length(operation_digest) = 32",
            name="ck_record_keys_operation_digest",
        ),
        schema="plyr_command",
    )
    if _role_exists():
        op.execute(f"GRANT USAGE ON SCHEMA plyr_command TO {CANARY_ROLE}")
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON plyr_command.record_keys "
            f"TO {CANARY_ROLE}"
        )


def downgrade() -> None:
    """Remove only successor command-key state."""
    if _role_exists():
        op.execute(
            "REVOKE SELECT, INSERT, UPDATE, DELETE ON plyr_command.record_keys "
            f"FROM {CANARY_ROLE}"
        )
        op.execute(f"REVOKE USAGE ON SCHEMA plyr_command FROM {CANARY_ROLE}")
    op.drop_table("record_keys", schema="plyr_command")
    op.execute("DROP SCHEMA plyr_command")

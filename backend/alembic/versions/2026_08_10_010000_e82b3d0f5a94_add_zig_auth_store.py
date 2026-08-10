"""add zig auth store

Revision ID: e82b3d0f5a94
Revises: d71a2c9e4f83
Create Date: 2026-08-10 01:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "e82b3d0f5a94"
down_revision: str | Sequence[str] | None = "d71a2c9e4f83"
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
    """Create non-rebuildable auth state with no plaintext bearer lookup keys."""
    op.execute("CREATE SCHEMA plyr_auth")
    op.create_table(
        "oauth_requests",
        sa.Column("state_digest", sa.LargeBinary(32), primary_key=True),
        sa.Column("sealed_payload", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "octet_length(state_digest) = 32", name="ck_oauth_requests_state_digest"
        ),
        schema="plyr_auth",
    )
    op.create_index(
        "ix_oauth_requests_expires_at",
        "oauth_requests",
        ["expires_at"],
        schema="plyr_auth",
    )

    op.create_table(
        "sessions",
        sa.Column("session_digest", sa.LargeBinary(32), primary_key=True),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("did", sa.Text(), nullable=False),
        sa.Column("handle", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("sealed_credentials", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "octet_length(session_digest) = 32", name="ck_sessions_session_digest"
        ),
        sa.CheckConstraint("did LIKE 'did:%'", name="ck_sessions_did"),
        schema="plyr_auth",
    )
    op.create_index(
        "ix_sessions_group_active",
        "sessions",
        ["group_id", "created_at"],
        schema="plyr_auth",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "ix_sessions_did_active",
        "sessions",
        ["did"],
        schema="plyr_auth",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    op.create_table(
        "exchange_tokens",
        sa.Column("token_digest", sa.LargeBinary(32), primary_key=True),
        sa.Column(
            "session_digest",
            sa.LargeBinary(32),
            sa.ForeignKey("plyr_auth.sessions.session_digest", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sealed_session_token", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "octet_length(token_digest) = 32", name="ck_exchange_tokens_token_digest"
        ),
        schema="plyr_auth",
    )
    op.create_index(
        "ix_exchange_tokens_expires_at",
        "exchange_tokens",
        ["expires_at"],
        schema="plyr_auth",
    )

    if _role_exists():
        op.execute(f"GRANT USAGE ON SCHEMA plyr_auth TO {CANARY_ROLE}")
        op.execute(
            f"GRANT SELECT, INSERT, DELETE ON plyr_auth.oauth_requests TO {CANARY_ROLE}"
        )
        op.execute(f"GRANT SELECT, INSERT ON plyr_auth.sessions TO {CANARY_ROLE}")
        op.execute(f"GRANT UPDATE (revoked_at) ON plyr_auth.sessions TO {CANARY_ROLE}")
        op.execute(
            "GRANT SELECT, INSERT, DELETE ON plyr_auth.exchange_tokens "
            f"TO {CANARY_ROLE}"
        )


def downgrade() -> None:
    """Remove only the isolated successor auth store."""
    if _role_exists():
        op.execute(
            "REVOKE SELECT, INSERT, DELETE ON plyr_auth.exchange_tokens "
            f"FROM {CANARY_ROLE}"
        )
        op.execute(
            f"REVOKE UPDATE (revoked_at) ON plyr_auth.sessions FROM {CANARY_ROLE}"
        )
        op.execute(f"REVOKE SELECT, INSERT ON plyr_auth.sessions FROM {CANARY_ROLE}")
        op.execute(
            "REVOKE SELECT, INSERT, DELETE ON plyr_auth.oauth_requests "
            f"FROM {CANARY_ROLE}"
        )
        op.execute(f"REVOKE USAGE ON SCHEMA plyr_auth FROM {CANARY_ROLE}")
    op.drop_table("exchange_tokens", schema="plyr_auth")
    op.drop_table("sessions", schema="plyr_auth")
    op.drop_table("oauth_requests", schema="plyr_auth")
    op.execute("DROP SCHEMA plyr_auth")

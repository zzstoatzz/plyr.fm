"""grant zig canary play writes

Revision ID: c69d4e8a217f
Revises: b58f2a7c91d4
Create Date: 2026-08-09 08:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "c69d4e8a217f"
down_revision: str | Sequence[str] | None = "b58f2a7c91d4"
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
    """Grant only the writes needed by the sustained-play use case."""
    if not _role_exists():
        return
    op.execute(f"GRANT INSERT, UPDATE ON plyr_index.track_metrics TO {CANARY_ROLE}")
    op.execute(f"GRANT UPDATE (play_count) ON public.tracks TO {CANARY_ROLE}")
    op.execute(f"GRANT SELECT ON public.share_links TO {CANARY_ROLE}")
    op.execute(f"GRANT INSERT ON public.share_link_events TO {CANARY_ROLE}")
    op.execute(
        f"GRANT USAGE ON SEQUENCE public.share_link_events_id_seq TO {CANARY_ROLE}"
    )


def downgrade() -> None:
    """Return the canary role to its previous read-only projection access."""
    if not _role_exists():
        return
    op.execute(
        f"REVOKE USAGE ON SEQUENCE public.share_link_events_id_seq FROM {CANARY_ROLE}"
    )
    op.execute(f"REVOKE INSERT ON public.share_link_events FROM {CANARY_ROLE}")
    op.execute(f"REVOKE SELECT ON public.share_links FROM {CANARY_ROLE}")
    op.execute(f"REVOKE UPDATE (play_count) ON public.tracks FROM {CANARY_ROLE}")
    op.execute(f"REVOKE INSERT, UPDATE ON plyr_index.track_metrics FROM {CANARY_ROLE}")

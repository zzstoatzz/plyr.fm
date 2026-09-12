"""Add publishing defaults preserving the effective download choice.

Revision ID: 311b4f106c90
Revises: a81c2d9e4f07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "311b4f106c90"
down_revision: str | Sequence[str] | None = "a81c2d9e4f07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column(
            "publishing_defaults",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "albums",
        sa.Column("publishing_defaults", postgresql.JSONB(), nullable=True),
    )
    op.add_column(
        "tracks",
        sa.Column(
            "download_policy", sa.String(), nullable=False, server_default="open"
        ),
    )
    op.add_column(
        "tracks",
        sa.Column("policy_origin", sa.String(), nullable=False, server_default="track"),
    )
    op.execute("""
        UPDATE tracks AS t
        SET download_policy = CASE
            WHEN t.visibility = 'private' OR t.support_gate IS NOT NULL THEN 'off'
            ELSE COALESCE(t.extra->>'download_policy',
                (SELECT COALESCE(p.download_policy,
                    CASE WHEN p.support_url IS NOT NULL AND p.support_url <> ''
                    THEN 'ask' ELSE 'open' END)
                 FROM user_preferences p WHERE p.did = t.artist_did), 'open')
            END,
            extra = COALESCE(t.extra, '{}'::jsonb) - 'download_policy',
            audio_storage = CASE WHEN t.support_gate IS NOT NULL THEN 'r2_private' ELSE t.audio_storage END,
            support_gate = CASE WHEN t.support_gate->>'type' = 'copyright'
                THEN '{"type":"signed_in"}'::jsonb ELSE t.support_gate END,
            visibility = CASE WHEN t.visibility = 'supporters' THEN 'public' ELSE t.visibility END
    """)
    op.execute("""
        UPDATE user_preferences
        SET publishing_defaults = jsonb_build_object(
            'access', jsonb_build_object(
                'listening', 'public',
                'visibility', 'public',
                'downloads', COALESCE(download_policy,
                    CASE WHEN support_url IS NOT NULL AND support_url <> ''
                    THEN 'ask' ELSE 'open' END)
            ),
            'attach_rights', false
        )
    """)

    op.drop_column("user_preferences", "download_policy")


def downgrade() -> None:
    raise RuntimeError(
        "publishing policy migration requires a forward repair; automatic rollback would lose per-work access"
    )

"""canonicalize permissioned space uris

Revision ID: d4f7a2c9b831
Revises: c8f3a6d9e2b1
Create Date: 2026-07-20 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f7a2c9b831"
down_revision: str | Sequence[str] | None = "c8f3a6d9e2b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Move experimental ats:// values to Proposal-0016 at:// space URIs."""
    op.execute(
        r"""
        UPDATE tracks
        SET space_uri = regexp_replace(
            space_uri,
            '^ats://([^/]+)/([^/]+)/([^/]+)$',
            'at://\1/space/\2/\3'
        )
        WHERE space_uri LIKE 'ats://%'
        """
    )
    op.execute(
        r"""
        UPDATE tracks
        SET atproto_record_uri = regexp_replace(
            atproto_record_uri,
            '^ats://([^/]+)/([^/]+)/([^/]+)/(.*)$',
            'at://\1/space/\2/\3/\4'
        )
        WHERE atproto_record_uri LIKE 'ats://%'
        """
    )


def downgrade() -> None:
    """Restore the earlier experimental URI representation."""
    op.execute(
        r"""
        UPDATE tracks
        SET space_uri = regexp_replace(
            space_uri,
            '^at://([^/]+)/space/([^/]+)/([^/]+)$',
            'ats://\1/\2/\3'
        )
        WHERE space_uri LIKE 'at://%/space/%'
        """
    )
    op.execute(
        r"""
        UPDATE tracks
        SET atproto_record_uri = regexp_replace(
            atproto_record_uri,
            '^at://([^/]+)/space/([^/]+)/([^/]+)/(.*)$',
            'ats://\1/\2/\3/\4'
        )
        WHERE atproto_record_uri LIKE 'at://%/space/%'
        """
    )

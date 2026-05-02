"""normalize track features to did-only

Revision ID: 90bfeb4a0dd3
Revises: 8bd123b1513d
Create Date: 2026-05-02 16:50:01.506415

before this migration `tracks.features` was a JSONB array of dicts
shaped like `[{did, handle, display_name|displayName, avatar_url}, ...]`
— a denormalized snapshot of each featured artist's profile at the
moment the feature was added (or last ingested from PDS).

that snapshot drifted on handle changes, display-name changes, and case
conventions (the ingest path used the lexicon's camelCase shape; the
upload path used snake_case). zzstoatzz/plyr.fm#1355 surfaced the
case-mismatch axis.

after this migration `tracks.features` stores ONLY the DID — the
canonical, immutable identifier. handle/display_name/avatar_url are
hydrated server-side at API-read time via
`backend._internal.atproto.profiles.resolve_dids` so they're always
fresh.

upgrade is a single in-place UPDATE — touches ~51 rows in prod, no
schema/index changes. downgrade is best-effort: it can rebuild the
shape but cannot reconstruct the historical handle/display_name
snapshots, so it falls back to the DID for both fields.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "90bfeb4a0dd3"
down_revision: str | Sequence[str] | None = "8bd123b1513d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """rewrite every features row to `[{did}, ...]`."""
    op.execute(
        """
        UPDATE tracks
        SET features = COALESCE(
            (
                SELECT jsonb_agg(jsonb_build_object('did', f->>'did'))
                FROM jsonb_array_elements(features) f
                WHERE f ? 'did' AND (f->>'did') IS NOT NULL
            ),
            '[]'::jsonb
        )
        WHERE features IS NOT NULL
          AND jsonb_array_length(features) > 0
        """
    )


def downgrade() -> None:
    """rehydrate snapshot fields from the DID itself.

    historical handle/display_name values aren't recoverable from the
    DID alone. setting both to the DID string keeps the shape
    lexicon-conformant under the pre-relax `featuredArtist` def
    (handle was required) and any reader that walks the dict will get
    a string back — just not a useful one. expectation is that
    downgrade is only used in dev to undo a bad deploy; the snapshot
    will be re-populated by the next ingest of the PDS record.
    """
    op.execute(
        """
        UPDATE tracks
        SET features = (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'did', f->>'did',
                    'handle', f->>'did',
                    'display_name', f->>'did'
                )
            )
            FROM jsonb_array_elements(features) f
            WHERE f ? 'did'
        )
        WHERE features IS NOT NULL
          AND jsonb_array_length(features) > 0
        """
    )

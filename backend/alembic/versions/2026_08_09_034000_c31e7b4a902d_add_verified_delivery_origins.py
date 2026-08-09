"""add verified delivery origins

Revision ID: c31e7b4a902d
Revises: a8d20f4bc731
Create Date: 2026-08-09 03:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c31e7b4a902d"
down_revision: str | Sequence[str] | None = "a8d20f4bc731"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Persist delivery URLs whose bytes were verified against an artifact CID."""
    op.create_table(
        "track_delivery_origins",
        sa.Column("record_uri", sa.Text(), primary_key=True),
        sa.Column("service", sa.Text(), primary_key=True),
        # Delivery evidence is bound to one exact authored record revision. A
        # later record at the same URI must not inherit an origin accidentally.
        sa.Column("record_cid", sa.Text(), nullable=False),
        sa.Column("origin_url", sa.Text(), nullable=False),
        sa.Column("media_type", sa.Text(), nullable=False),
        sa.Column("artifact_cid", sa.Text(), nullable=False),
        sa.Column("verification", sa.Text(), nullable=False),
        sa.Column("observed_at_us", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "service = 'r2' AND verification = 'verified_blob_cid'",
            name="ck_track_delivery_origins_evidence",
        ),
        sa.CheckConstraint(
            "length(origin_url) BETWEEN 1 AND 4096 "
            "AND length(media_type) BETWEEN 1 AND 255 "
            "AND observed_at_us >= 0",
            name="ck_track_delivery_origins_values",
        ),
        schema="plyr_index",
    )


def downgrade() -> None:
    """Remove only verified delivery-origin evidence."""
    op.drop_table("track_delivery_origins", schema="plyr_index")

"""Transitional ORM registration for canonical-URI application policy."""

from sqlalchemy import BigInteger, CheckConstraint, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class TrackPolicy(Base):
    """Independently sourced access and moderation claims for one track URI."""

    __tablename__ = "track_policies"
    __table_args__ = (
        CheckConstraint(
            "visibility IS NULL OR "
            "visibility IN ('public', 'unlisted', 'supporters', 'private')",
            name="ck_track_policies_visibility",
        ),
        CheckConstraint(
            "(visibility IS NULL AND space_uri IS NULL "
            "AND access_write_source IS NULL AND access_observed_at_us IS NULL) "
            "OR (visibility IS NOT NULL "
            "AND ((visibility = 'private') = (space_uri IS NOT NULL)) "
            "AND access_write_source IN ('legacy_import', 'local_command') "
            "AND access_observed_at_us >= 0)",
            name="ck_track_policies_access_shape",
        ),
        CheckConstraint(
            "jsonb_typeof(operator_labels) = 'array' "
            "AND operator_labels <@ "
            '\'["copyright-violation", "porn", "sexual"]\'::jsonb '
            "AND jsonb_array_length(operator_labels) <= 3",
            name="ck_track_policies_labels",
        ),
        CheckConstraint(
            "moderation_decision IS NULL "
            "OR moderation_decision IN ('allow', 'exclude')",
            name="ck_track_policies_moderation_decision",
        ),
        CheckConstraint(
            "(jsonb_array_length(operator_labels) = 0 "
            "AND moderation_decision IS NULL "
            "AND moderation_write_source IS NULL "
            "AND moderation_observed_at_us IS NULL) "
            "OR ((jsonb_array_length(operator_labels) > 0 "
            "OR moderation_decision IS NOT NULL) "
            "AND moderation_write_source IN ('legacy_import', 'labeler_sync') "
            "AND moderation_observed_at_us >= 0)",
            name="ck_track_policies_moderation_shape",
        ),
        CheckConstraint(
            "visibility IS NOT NULL OR jsonb_array_length(operator_labels) > 0 "
            "OR moderation_decision IS NOT NULL",
            name="ck_track_policies_nonempty",
        ),
        {"schema": "plyr_index"},
    )

    record_uri: Mapped[str] = mapped_column(Text, primary_key=True)
    visibility: Mapped[str | None] = mapped_column(Text, nullable=True)
    space_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_write_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_observed_at_us: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    operator_labels: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    moderation_decision: Mapped[str | None] = mapped_column(Text, nullable=True)
    moderation_write_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    moderation_observed_at_us: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )

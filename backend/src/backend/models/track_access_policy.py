"""Transitional ORM registration for application-owned track access policy."""

from sqlalchemy import BigInteger, CheckConstraint, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class TrackAccessPolicy(Base):
    """Portable access decision keyed by canonical track-record URI."""

    __tablename__ = "track_access_policies"
    __table_args__ = (
        CheckConstraint(
            "visibility IN ('public', 'unlisted', 'supporters', 'private')",
            name="ck_track_access_policies_visibility",
        ),
        CheckConstraint(
            "(visibility = 'private') = (space_uri IS NOT NULL)",
            name="ck_track_access_policies_space",
        ),
        CheckConstraint(
            "write_source IN ('legacy_import', 'local_command') "
            "AND observed_at_us >= 0",
            name="ck_track_access_policies_source_time",
        ),
        {"schema": "plyr_index"},
    )

    record_uri: Mapped[str] = mapped_column(Text, primary_key=True)
    visibility: Mapped[str] = mapped_column(Text, nullable=False)
    space_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    write_source: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at_us: Mapped[int] = mapped_column(BigInteger, nullable=False)

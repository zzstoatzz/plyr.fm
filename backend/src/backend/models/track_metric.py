"""Transitional ORM registration for application-owned track metrics."""

from sqlalchemy import BigInteger, CheckConstraint, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class TrackMetric(Base):
    """Current derived aggregates keyed by portable record identity."""

    __tablename__ = "track_metrics"
    __table_args__ = (
        CheckConstraint(
            "play_count >= 0",
            name="ck_track_metrics_play_count",
        ),
        CheckConstraint(
            "write_source IN ('legacy_import', 'http_play', 'subsonic_scrobble')",
            name="ck_track_metrics_write_source",
        ),
        CheckConstraint(
            "observed_at_us >= 0",
            name="ck_track_metrics_observed_at",
        ),
        {"schema": "plyr_index"},
    )

    record_uri: Mapped[str] = mapped_column(Text, primary_key=True)
    play_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    write_source: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at_us: Mapped[int] = mapped_column(BigInteger, nullable=False)

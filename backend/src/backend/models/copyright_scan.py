"""copyright scan model for tracking moderation results."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class CopyrightScan(Base):
    """copyright scan result from moderation service.

    stores scan results from AuDD API. the labeler service is the source
    of truth for whether a track is actively flagged (label not negated).

    the is_flagged field here indicates the initial scan result. the
    sync_copyright_resolutions background task updates it when labels
    are negated in the labeler.
    """

    __tablename__ = "copyright_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # link to track
    track_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # scan results
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    is_flagged: Mapped[bool] = mapped_column(nullable=False, default=False)
    highest_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # detailed match data
    matches: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default="[]",
    )
    raw_response: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
    )

    __table_args__ = (
        Index("idx_copyright_scans_flagged", "is_flagged"),
        Index("idx_copyright_scans_scanned_at", "scanned_at"),
    )

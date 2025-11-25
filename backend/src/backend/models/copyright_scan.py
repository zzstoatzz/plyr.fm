"""copyright scan model for tracking moderation results."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class ScanResolution(str, Enum):
    """resolution status for a flagged scan."""

    PENDING = "pending"  # awaiting review
    DISMISSED = "dismissed"  # false positive, no action needed
    REMOVED = "removed"  # track was removed
    LICENSED = "licensed"  # verified to be properly licensed


class CopyrightScan(Base):
    """copyright scan result from moderation service.

    stores scan results from AuDD API for tracking potential
    copyright issues without immediate enforcement (ozone pattern).
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

    # review tracking (for later human review)
    resolution: Mapped[str | None] = mapped_column(String, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)  # DID
    review_notes: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("idx_copyright_scans_flagged", "is_flagged"),
        Index("idx_copyright_scans_scanned_at", "scanned_at"),
    )

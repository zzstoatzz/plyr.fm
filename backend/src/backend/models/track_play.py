"""timestamped play events behind the activity chart's plays series."""

from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class TrackPlay(Base):
    """one counted play of a track. carries no listener identity.

    `source = "teal"` rows are backfilled from plyr-origin teal.fm scrobbles
    and cover only listeners who scrobbled.
    """

    __tablename__ = "track_plays"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    track_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False
    )
    played_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "track_id", "played_at", "source", name="uq_track_plays_event"
        ),
    )

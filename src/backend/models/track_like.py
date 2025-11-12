"""track like model for indexing ATProto like records."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.track import Track


class TrackLike(Base):
    """track like model.

    indexes ATProto like records (fm.plyr.like) for efficient querying.
    the source of truth is the ATProto record on the user's PDS.
    """

    __tablename__ = "track_likes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # which track is liked
    track_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    track: Mapped["Track"] = relationship("Track", lazy="raise")

    # who liked it
    user_did: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # ATProto like record URI (source of truth)
    atproto_like_uri: Mapped[str] = mapped_column(
        String, nullable=False, unique=True, index=True
    )

    # when it was liked (indexed from ATProto record)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # one like per user per track
        UniqueConstraint("track_id", "user_did", name="uq_track_user_like"),
        # composite index for efficient user likes queries with sorting
        Index("ix_track_likes_user_did_created_at", "user_did", created_at.desc()),
    )

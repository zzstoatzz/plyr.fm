"""track comment model for timed comments on tracks."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.track import Track


class TrackComment(Base):
    """timed comment on a track.

    indexes ATProto comment records (fm.plyr.comment) for efficient querying.
    the source of truth is the ATProto record on the user's PDS.
    """

    __tablename__ = "track_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # which track is being commented on
    track_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    track: Mapped["Track"] = relationship("Track", lazy="raise")

    # who commented
    user_did: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # comment content
    text: Mapped[str] = mapped_column(Text, nullable=False)

    # playback position in milliseconds when comment was made
    timestamp_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    # ATProto comment record URI (source of truth)
    atproto_comment_uri: Mapped[str] = mapped_column(
        String, nullable=False, unique=True, index=True
    )

    # when it was created (indexed from ATProto record)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # when it was last updated (null if never edited)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    __table_args__ = (
        # composite index for fetching comments ordered by timestamp
        Index("ix_track_comments_track_timestamp", "track_id", "timestamp_ms"),
        # composite index for user's comments (order by recency handled in queries)
        Index("ix_track_comments_user_created", "user_did", "created_at"),
    )

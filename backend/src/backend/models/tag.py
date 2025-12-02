"""tag models for track labeling."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.artist import Artist
    from backend.models.track import Track


class Tag(Base):
    """globally shared tag for categorizing tracks."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    created_by_did: Mapped[str] = mapped_column(
        String,
        ForeignKey("artists.did"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # relationships
    tracks: Mapped[list["TrackTag"]] = relationship(
        "TrackTag", back_populates="tag", cascade="all, delete-orphan"
    )
    creator: Mapped["Artist"] = relationship("Artist", lazy="raise")


class TrackTag(Base):
    """join table for track-tag many-to-many relationship."""

    __tablename__ = "track_tags"
    __table_args__ = (
        UniqueConstraint("track_id", "tag_id", name="uq_track_tag"),
        Index("ix_track_tags_tag_id", "tag_id"),
    )

    track_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # relationships
    track: Mapped["Track"] = relationship("Track", back_populates="track_tags")
    tag: Mapped["Tag"] = relationship("Tag", back_populates="tracks")

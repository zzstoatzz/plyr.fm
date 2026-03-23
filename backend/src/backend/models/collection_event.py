"""collection activity event model for tracking playlist/album mutations."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class CollectionEvent(Base):
    """append-only log of collection mutations (playlist creates, album releases, etc).

    written from API endpoints at mutation time. consumed by the activity feed
    as a 5th UNION branch alongside likes, uploads, comments, and joins.
    """

    __tablename__ = "collection_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    event_type: Mapped[str] = mapped_column(
        String, nullable=False
    )  # playlist_create | album_release | track_added_to_playlist

    actor_did: Mapped[str] = mapped_column(
        String,
        ForeignKey("artists.did"),
        nullable=False,
    )

    playlist_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("playlists.id", ondelete="SET NULL"),
        nullable=True,
    )

    album_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("albums.id", ondelete="SET NULL"),
        nullable=True,
    )

    track_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_collection_events_created_at", created_at.desc()),
        Index("ix_collection_events_actor_did", "actor_did"),
    )

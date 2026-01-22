"""share link models for tracking who clicked shared track links."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.track import Track


class ShareLink(Base):
    """a shareable link to a track with a unique tracking code.

    when users share tracks, they get a URL with ?ref={code} appended.
    this lets us track who came from that specific share.
    """

    __tablename__ = "share_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # unique tracking code (e.g., "abc12345")
    code: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)

    # which track is being shared
    track_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    track: Mapped["Track"] = relationship("Track", lazy="raise")

    # who created the share link
    creator_did: Mapped[str] = mapped_column(String, nullable=False, index=True)

    # when the share link was created
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # relationship to events
    events: Mapped[list["ShareLinkEvent"]] = relationship(
        "ShareLinkEvent", back_populates="share_link", lazy="raise"
    )

    __table_args__ = (
        # composite index for listing user's shares sorted by recency
        Index(
            "ix_share_links_creator_did_created_at", "creator_did", created_at.desc()
        ),
    )


class ShareLinkEvent(Base):
    """an event (click or play) on a share link.

    records when someone visits a track via a share link (click)
    and when they actually play it (play).
    """

    __tablename__ = "share_link_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # which share link this event is for
    share_link_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("share_links.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    share_link: Mapped["ShareLink"] = relationship(
        "ShareLink", back_populates="events", lazy="raise"
    )

    # who triggered the event (null = anonymous visitor)
    visitor_did: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # event type: 'click' (page load) or 'play' (30s played)
    event_type: Mapped[str] = mapped_column(String, nullable=False)

    # when the event occurred
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # composite index for aggregating stats per share link
        Index("ix_share_link_events_link_type", "share_link_id", "event_type"),
    )

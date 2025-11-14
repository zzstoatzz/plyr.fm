"""artist model for storing artist profile data."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.album import Album
    from backend.models.track import Track


class Artist(Base):
    """artist profile linked to ATProto identity."""

    __tablename__ = "artists"

    # ATProto identity (immutable)
    did: Mapped[str] = mapped_column(String, primary_key=True)
    handle: Mapped[str] = mapped_column(String, nullable=False)

    # artist profile (mutable)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    bio: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # cached PDS URL (for performance)
    pds_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # relationship
    tracks: Mapped[list["Track"]] = relationship("Track", back_populates="artist")
    albums: Mapped[list["Album"]] = relationship("Album", back_populates="artist")

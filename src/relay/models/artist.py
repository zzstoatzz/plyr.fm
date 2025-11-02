"""artist model for storing artist profile data."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from relay.models.database import Base

if TYPE_CHECKING:
    from relay.models.track import Track


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

    # metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # relationship
    tracks: Mapped[list["Track"]] = relationship("Track", back_populates="artist")

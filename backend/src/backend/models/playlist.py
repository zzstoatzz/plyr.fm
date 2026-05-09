"""playlist model for caching ATProto list records."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base


class Playlist(Base):
    """playlist metadata.

    public playlists cache an ATProto list record on the user's PDS;
    ``atproto_record_uri`` is the source of truth for items.

    private playlists live in a permissioned space (``space_uri`` set,
    ``atproto_record_uri`` NULL); the corresponding ``SpaceRecord``
    holds the items inline. see ``backend._internal.spaces``.
    """

    __tablename__ = "playlists"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    owner_did: Mapped[str] = mapped_column(
        String,
        ForeignKey("artists.did"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    image_id: Mapped[str | None] = mapped_column(String, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String, nullable=True)
    atproto_record_uri: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        unique=True,
        index=True,
    )
    atproto_record_cid: Mapped[str | None] = mapped_column(String, nullable=True)
    space_uri: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("spaces.uri", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    track_count: Mapped[int] = mapped_column(default=0)
    show_on_profile: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
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

    owner = relationship("Artist", back_populates="playlists")

    async def get_image_url(self) -> str | None:
        """resolve image URL from storage."""
        if not self.image_id:
            return None
        from backend.storage import storage

        return await storage.get_url(self.image_id, file_type="image")

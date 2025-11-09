"""track model for storing music metadata."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.artist import Artist


class Track(Base):
    """track model.

    only essential fields are explicit columns.
    use metadata JSONB for flexible fields that may evolve.
    """

    __tablename__ = "tracks"

    # essential fields
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    file_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    file_type: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # artist relationship
    artist_did: Mapped[str] = mapped_column(
        String,
        ForeignKey("artists.did"),
        nullable=False,
        index=True,
    )
    artist: Mapped["Artist"] = relationship(
        "Artist", back_populates="tracks", lazy="raise"
    )

    # flexible extra fields (album, duration, genre, etc.)
    extra: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )

    # featured artists (list of {did, handle, display_name})
    features: Mapped[list[dict]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        server_default="[]",
    )

    # ATProto integration fields
    r2_url: Mapped[str | None] = mapped_column(String, nullable=True)
    atproto_record_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    atproto_record_cid: Mapped[str | None] = mapped_column(String, nullable=True)

    # engagement metrics
    play_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    @property
    def album(self) -> str | None:
        """get album from extra."""
        return self.extra.get("album")

    @property
    def duration(self) -> int | None:
        """get duration from extra (in seconds)."""
        return self.extra.get("duration")

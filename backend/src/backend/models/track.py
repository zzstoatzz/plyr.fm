"""track model for storing music metadata."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import ColumnElement, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.album import Album
    from backend.models.artist import Artist
    from backend.models.tag import TrackTag


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

    # original file (for transcoded uploads - preserves lossless original for export)
    original_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    original_file_type: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
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

    # album linkage
    album_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("albums.id"),
        nullable=True,
        index=True,
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

    # PDS blob storage (for audio stored on user's PDS)
    audio_storage: Mapped[str] = mapped_column(
        String, nullable=False, default="r2", server_default="r2"
    )  # "r2" | "pds" | "both"
    pds_blob_cid: Mapped[str | None] = mapped_column(String, nullable=True)
    pds_blob_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # publish state for reserve-then-publish flow
    # None = legacy (treated as published), "pending" = PDS write pending, "published" = confirmed
    publish_state: Mapped[str | None] = mapped_column(String, nullable=True)

    # track description (liner notes, show notes, etc.)
    description: Mapped[str | None] = mapped_column(String, nullable=True)

    # engagement metrics
    play_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # image reference
    image_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # visibility — single source of truth for discovery + access + where audio
    # lives. one mutually-exclusive value (no overlapping booleans):
    #   public     — in feeds; audio on R2/CDN; anyone
    #   unlisted   — NOT in feeds; audio on R2/CDN; anyone with the link
    #   supporters — in feeds (locked); audio in R2 private bucket; plyr.fm gates
    #                on atprotofans support; carries support_gate={"type":"any"}
    #   private    — NOT in feeds; audio + record live in the artist's ATProto
    #                permissioned space ON THEIR PDS (never R2); the PDS gates via
    #                a space credential; owner-only. space_uri holds the ats:// space.
    # copyright gating (indiemusi) is orthogonal — it rides on public/unlisted via
    # support_gate={"type":"copyright"} and the copyright_* pointers below.
    visibility: Mapped[str] = mapped_column(
        String, nullable=False, default="public", server_default="public", index=True
    )

    # notification tracking
    notification_sent: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="false"
    )

    # gating mechanism detail (drives the ATProto record's supportGate field +
    # audio access checks): {"type": "any"} for supporters, {"type": "copyright"}
    # for the indiemusi paradigm. None for ungated tracks.
    support_gate: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True, default=None
    )

    # 3-segment ats:// space URI for private (permissioned) media; None otherwise.
    space_uri: Mapped[str | None] = mapped_column(String, nullable=True)

    # copyright paradigm record pointers — set when the user has opted into a
    # copyright paradigm and filled out the rights form on upload/edit. AT-URIs
    # of records on the user's PDS (e.g. ch.indiemusi.alpha.song). pure
    # app-layer pointer; the PDS records themselves have no back-reference.
    copyright_song_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    copyright_recording_uri: Mapped[str | None] = mapped_column(String, nullable=True)

    # --- derived visibility helpers (usable in both Python and SQL queries) ---

    @hybrid_property
    def is_private(self) -> bool:
        """private (permissioned-space) media — owner-only, PDS-native."""
        return self.visibility == "private"

    @is_private.inplace.expression
    @classmethod
    def _is_private_expr(cls) -> ColumnElement[bool]:
        return cls.visibility == "private"

    @hybrid_property
    def in_discovery(self) -> bool:
        """appears in discovery feeds (latest / top / for-you / radio)."""
        return self.visibility in ("public", "supporters")

    @in_discovery.inplace.expression
    @classmethod
    def _in_discovery_expr(cls) -> ColumnElement[bool]:
        return cls.visibility.in_(("public", "supporters"))

    @property
    def is_gated(self) -> bool:
        """check if this track requires supporter access."""
        return self.support_gate is not None

    @property
    def album(self) -> str | None:
        """get album name from extra (for ATProto compatibility)."""
        return self.extra.get("album")

    @property
    def duration(self) -> int | None:
        """get duration from extra (in seconds)."""
        return self.extra.get("duration")

    async def get_image_url(self) -> str | None:
        """get image URL if available."""
        if not self.image_id:
            return None
        from backend.storage import storage

        return await storage.get_url(self.image_id, file_type="image")

    # relationships
    album_rel: Mapped["Album | None"] = relationship("Album", back_populates="tracks")
    track_tags: Mapped[list["TrackTag"]] = relationship(
        "TrackTag", back_populates="track", cascade="all, delete-orphan", lazy="raise"
    )

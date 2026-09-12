"""track model for storing music metadata."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import ColumnElement, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base
from backend.utilities.audio_formats import AudioFormat
from backend.utilities.publishing import PublishingDefaults, PublishingPolicy

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
    # Repo commit `rev` (a TID) of the last record state applied to this row.
    # The firehose gives no ordering or exactly-once guarantee, so a re-emitted
    # historical commit can arrive after a newer one; `rev` is monotonic per
    # repo and survives re-delivery, which `time_us` does not (jetstream stamps
    # that on receipt). Ingest refuses to apply a commit at or below this.
    atproto_record_rev: Mapped[str | None] = mapped_column(String, nullable=True)
    # Author-published `com.atproto.label.defs#selfLabels` values. These remain
    # separate from signed operator labels so provenance stays intact.
    self_labels: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    # Active operator label values projected from the labeler so visibility
    # can be enforced in SQL. The labeler stays the source of truth; the
    # sync_operator_labels background task reconciles this every few minutes
    # for the values it manages. Authorization paths must not read this —
    # they query the labeler live (see may_stream_sensitive_audio).
    operator_labels: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    # Standing operator decision projected from the moderation event log:
    # "allow" surfaces the track despite a copyright label, "exclude" keeps it
    # out of chosen surfaces (feeds, search, radio) regardless of labels —
    # never out of destinations like the artist's own page. Distinct from
    # negating a label, which claims the assertion itself was wrong.
    moderation_override: Mapped[str | None] = mapped_column(String, nullable=True)

    # PDS blob storage (for audio stored on user's PDS)
    audio_storage: Mapped[str] = mapped_column(
        String, nullable=False, default="r2", server_default="r2"
    )  # "r2" | "r2_private" | "pds" | "both"
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

    # Discovery and metadata visibility; action permissions are independent.
    visibility: Mapped[str] = mapped_column(
        String, nullable=False, default="public", server_default="public", index=True
    )

    # notification tracking
    notification_sent: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="false"
    )

    # Listening audience: any (supporters), signed_in, owner, or no gate.
    support_gate: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True, default=None
    )

    # canonical at:// permissioned-space URI for private media; None otherwise.
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
        """private media — the Space authority admits readers."""
        return self.visibility == "private"

    @is_private.inplace.expression
    @classmethod
    def _is_private_expr(cls) -> ColumnElement[bool]:
        return cls.visibility == "private"

    @hybrid_property
    def in_discovery(self) -> bool:
        """appears in discovery feeds (latest / top / for-you / radio)."""
        return self.visibility == "public"

    @in_discovery.inplace.expression
    @classmethod
    def _in_discovery_expr(cls) -> ColumnElement[bool]:
        return cls.visibility == "public"

    @hybrid_property
    def is_optimizing(self) -> bool:
        """published with an interim lossless rendition, deferred mp3 optimize
        still pending. the optimize task writes the canonical PDS blob itself
        when the mp3 lands, so optimizing tracks are never offered for manual
        PDS saves. a directly-uploaded web-playable track (no original) is
        never in this state."""
        return (
            self.file_type != AudioFormat.MP3.value
            and self.original_file_id is not None
            and self.original_file_type is not None
        )

    @is_optimizing.inplace.expression
    @classmethod
    def _is_optimizing_expr(cls) -> ColumnElement[bool]:
        return (
            (cls.file_type != AudioFormat.MP3.value)
            & cls.original_file_id.isnot(None)
            & cls.original_file_type.isnot(None)
        )

    @hybrid_property
    def uses_private_audio(self) -> bool:
        """R2 location, including legacy gated rows."""
        return self.audio_storage == "r2_private" or self.support_gate is not None

    @uses_private_audio.inplace.expression
    @classmethod
    def _uses_private_audio_expr(cls) -> ColumnElement[bool]:
        return (cls.audio_storage == "r2_private") | cls.support_gate.isnot(None)

    download_policy: Mapped[str] = mapped_column(
        String, nullable=False, default="open", server_default="open"
    )
    policy_origin: Mapped[str] = mapped_column(
        String, nullable=False, default="track", server_default="track"
    )

    @property
    def publishing(self) -> PublishingDefaults:
        gate = (self.support_gate or {}).get("type")
        listening = (
            "space"
            if self.is_private
            else {"any": "supporters", "signed_in": "signed_in", "owner": "owner"}.get(
                gate, "owner"
            )
            if self.support_gate
            else "public"
        )
        return PublishingDefaults(
            access=PublishingPolicy.model_validate(
                {
                    "listening": listening,
                    "downloads": self.download_policy,
                    "visibility": self.visibility,
                }
            ),
            attach_rights=bool(self.copyright_song_uri or self.copyright_recording_uri),
        )

    @property
    def needs_supporter_check(self) -> bool:
        return self.download_policy == "supporters" or bool(
            self.support_gate and self.support_gate.get("type") == "any"
        )

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

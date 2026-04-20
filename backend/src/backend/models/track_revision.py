"""historical audio revisions for a track.

a TrackRevision row represents a PRIOR audio version for a track. the Track
itself always holds the CURRENT audio in its own columns; revisions are
strictly historical.

written on every audio replace (snapshot of the about-to-be-displaced state)
and on every restore (snapshot of the about-to-be-replaced current). pruned
to a per-track cap (`MAX_REVISIONS_PER_TRACK`) — oldest revisions are deleted
along with their backing blobs.

column names are intentionally provider-neutral: `audio_url` instead of
`r2_url`, so that swapping blob providers later doesn't leave cruft behind.
the `audio_storage` column mirrors `Track.audio_storage` values for parity
("r2" | "pds" | "both").
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base

if TYPE_CHECKING:
    from backend.models.track import Track


# per-track retention cap. when a new revision pushes count above this, the
# oldest revision is pruned (and its backing blob is deleted if no other
# row references it).
MAX_REVISIONS_PER_TRACK = 10


class TrackRevision(Base):
    """a previous audio version of a track."""

    __tablename__ = "track_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    track_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tracks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    track: Mapped["Track"] = relationship("Track", lazy="raise")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    # --- audio snapshot (provider-neutral column names) ---

    # primary playable file pointer (mirrors Track.file_id)
    file_id: Mapped[str] = mapped_column(String, nullable=False)

    # playable file format (mp3, m4a, etc.)
    file_type: Mapped[str] = mapped_column(String, nullable=False)

    # lossless original (when current was transcoded at upload time)
    original_file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    original_file_type: Mapped[str | None] = mapped_column(String, nullable=True)

    # storage location: "r2" | "pds" | "both" — mirrors Track.audio_storage
    audio_storage: Mapped[str] = mapped_column(String, nullable=False)

    # public CDN URL for the playable file (or gated backend URL if was_gated).
    # named generically so we can swap blob providers without renaming.
    audio_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # PDS blob ref (when audio_storage in {"pds", "both"})
    pds_blob_cid: Mapped[str | None] = mapped_column(String, nullable=True)
    pds_blob_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # --- display + restore-safety helpers ---

    # duration in seconds at time of snapshot (denormalized from Track.extra)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # was the track support-gated when this revision was current? used to
    # detect cross-bucket restore attempts (public ↔ gated) which require
    # blob migration work we haven't built yet.
    was_gated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    __table_args__ = (
        # newest-first listing for a track's history
        Index("ix_track_revisions_track_created", "track_id", created_at.desc()),
    )

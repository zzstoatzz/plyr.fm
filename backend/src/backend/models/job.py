"""Job models for tracking long-running tasks."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class JobStatus(str, Enum):
    """Status of a job."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class JobType(str, Enum):
    """Type of job."""

    UPLOAD = "upload"
    EXPORT = "export"
    PDS_SAVE = "pds_save"
    # deferred MP3 optimization of a track published with the interim WAV
    # rendition. a distinct type so the stuck-upload reaper (which scans
    # type='upload') never reaps a legitimately long encode running here.
    OPTIMIZE = "optimize"


class Job(Base):
    """Job for tracking long-running tasks."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid4())
    )
    type: Mapped[str] = mapped_column(String, nullable=False)  # JobType enum
    status: Mapped[str] = mapped_column(
        String, nullable=False, default=JobStatus.PENDING.value
    )  # JobStatus enum
    owner_did: Mapped[str] = mapped_column(String, nullable=False)

    # Progress
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(String, nullable=True)
    phase: Mapped[str | None] = mapped_column(String, nullable=True)

    # Result/Error
    result: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(String, nullable=True)

    # Staged-media cleanup hints for the stuck-upload reaper. populated when
    # an upload job row is created so that if the job sits in `processing`
    # past the reaper threshold, we can delete the staged R2 blob from the
    # right bucket (public vs gated) before marking the job failed. nullable
    # so non-upload job types (export, pds_save) don't need them; also
    # nullable to support upload rows created before this migration.
    file_id: Mapped[str | None] = mapped_column(String, nullable=True)
    file_type: Mapped[str | None] = mapped_column(String, nullable=True)
    is_gated: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("idx_jobs_owner", "owner_did"),
        Index("idx_jobs_updated_at", "updated_at"),
        # composite index for the stuck-upload reaper's hot query:
        # WHERE type = 'upload' AND status = 'processing' AND updated_at < ?
        Index("idx_jobs_reaper_scan", "type", "status", "updated_at"),
    )

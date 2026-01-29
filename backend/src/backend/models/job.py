"""Job models for tracking long-running tasks."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from sqlalchemy import DateTime, Float, Index, String
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
    PDS_BACKFILL = "pds_backfill"


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
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)

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
    )

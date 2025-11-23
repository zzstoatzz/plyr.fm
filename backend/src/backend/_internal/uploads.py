"""async upload tracking and background processing."""

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

# maximum number of buffered progress updates per upload listener
# this prevents memory buildup if a client disconnects without properly closing the SSE connection
MAX_PROGRESS_QUEUE_SIZE = 10


class UploadStatus(str, Enum):
    """upload status enum."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class UploadProgress:
    """upload progress state."""

    upload_id: str
    status: UploadStatus
    message: str
    track_id: int | None = None
    error: str | None = None
    created_at: datetime | None = None
    completed_at: datetime | None = None
    server_progress_pct: float | None = None
    phase: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """serialize to dict."""
        return {
            "upload_id": self.upload_id,
            "status": self.status.value,
            "message": self.message,
            "track_id": self.track_id,
            "error": self.error,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
            "server_progress_pct": self.server_progress_pct,
            "phase": self.phase,
        }


class UploadTracker:
    """tracks upload progress in memory."""

    def __init__(self):
        self._uploads: dict[str, UploadProgress] = {}
        self._listeners: dict[str, list[asyncio.Queue]] = {}

    def create_upload(self) -> str:
        """create a new upload and return its ID."""
        upload_id = str(uuid4())
        self._uploads[upload_id] = UploadProgress(
            upload_id=upload_id,
            status=UploadStatus.PENDING,
            message="upload queued",
            created_at=datetime.now(UTC),
        )
        self._listeners[upload_id] = []
        return upload_id

    def update_status(
        self,
        upload_id: str,
        status: UploadStatus,
        message: str,
        track_id: int | None = None,
        error: str | None = None,
        server_progress_pct: float | None = None,
        phase: str | None = None,
    ) -> None:
        """update upload status and notify listeners."""
        if upload_id not in self._uploads:
            logger.warning(f"attempted to update unknown upload: {upload_id}")
            return

        upload = self._uploads[upload_id]
        upload.status = status
        upload.message = message
        upload.track_id = track_id
        upload.error = error
        upload.server_progress_pct = server_progress_pct
        upload.phase = phase

        if status in (UploadStatus.COMPLETED, UploadStatus.FAILED):
            upload.completed_at = datetime.now(UTC)

        # notify all listeners
        if upload_id in self._listeners:
            for queue in self._listeners[upload_id]:
                try:
                    queue.put_nowait(upload.to_dict())
                except asyncio.QueueFull:
                    logger.warning(f"listener queue full for upload {upload_id}")

    def get_status(self, upload_id: str) -> UploadProgress | None:
        """get current upload status."""
        return self._uploads.get(upload_id)

    async def subscribe(self, upload_id: str) -> asyncio.Queue:
        """subscribe to upload progress updates."""
        if upload_id not in self._listeners:
            self._listeners[upload_id] = []

        queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_PROGRESS_QUEUE_SIZE)
        self._listeners[upload_id].append(queue)

        # send current status immediately
        if upload_id in self._uploads:
            await queue.put(self._uploads[upload_id].to_dict())

        return queue

    def unsubscribe(self, upload_id: str, queue: asyncio.Queue) -> None:
        """unsubscribe from upload progress."""
        if upload_id in self._listeners:
            with contextlib.suppress(ValueError):
                self._listeners[upload_id].remove(queue)

    def cleanup_old_uploads(self, max_age_seconds: int = 3600) -> None:
        """remove uploads older than max_age_seconds."""
        now = datetime.now(UTC)
        to_remove = []

        for upload_id, upload in self._uploads.items():
            if upload.completed_at:
                age = (now - upload.completed_at).total_seconds()
                if age > max_age_seconds:
                    to_remove.append(upload_id)

        for upload_id in to_remove:
            del self._uploads[upload_id]
            if upload_id in self._listeners:
                del self._listeners[upload_id]


# global tracker instance
upload_tracker = UploadTracker()

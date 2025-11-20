"""async export tracking and background processing."""

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

# maximum number of buffered progress updates per export listener
MAX_PROGRESS_QUEUE_SIZE = 10


class ExportStatus(str, Enum):
    """export status enum."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ExportProgress:
    """export progress state."""

    export_id: str
    status: ExportStatus
    message: str
    track_count: int | None = None
    processed_count: int = 0
    error: str | None = None
    created_at: datetime | None = None
    completed_at: datetime | None = None
    download_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """serialize to dict."""
        return {
            "export_id": self.export_id,
            "status": self.status.value,
            "message": self.message,
            "track_count": self.track_count,
            "processed_count": self.processed_count,
            "error": self.error,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
            "download_url": self.download_url,
        }


class ExportTracker:
    """tracks export progress in memory."""

    def __init__(self):
        self._exports: dict[str, ExportProgress] = {}
        self._listeners: dict[str, list[asyncio.Queue]] = {}
        self._export_data: dict[str, bytes] = {}  # store zip data temporarily

    def create_export(self, track_count: int) -> str:
        """create a new export and return its ID."""
        export_id = str(uuid4())
        self._exports[export_id] = ExportProgress(
            export_id=export_id,
            status=ExportStatus.PENDING,
            message="export queued",
            track_count=track_count,
            created_at=datetime.now(UTC),
        )
        self._listeners[export_id] = []
        return export_id

    def update_status(
        self,
        export_id: str,
        status: ExportStatus,
        message: str,
        processed_count: int | None = None,
        error: str | None = None,
    ) -> None:
        """update export status and notify listeners."""
        if export_id not in self._exports:
            logger.warning(f"attempted to update unknown export: {export_id}")
            return

        export = self._exports[export_id]
        export.status = status
        export.message = message
        if processed_count is not None:
            export.processed_count = processed_count
        export.error = error

        if status in (ExportStatus.COMPLETED, ExportStatus.FAILED):
            export.completed_at = datetime.now(UTC)

        # notify all listeners
        if export_id in self._listeners:
            for queue in self._listeners[export_id]:
                try:
                    queue.put_nowait(export.to_dict())
                except asyncio.QueueFull:
                    logger.warning(f"listener queue full for export {export_id}")

    def store_export_data(self, export_id: str, data: bytes) -> None:
        """store the export zip data temporarily."""
        self._export_data[export_id] = data
        if export_id in self._exports:
            self._exports[export_id].download_url = f"/exports/{export_id}/download"

    def get_export_data(self, export_id: str) -> bytes | None:
        """get the stored export data."""
        return self._export_data.get(export_id)

    def get_status(self, export_id: str) -> ExportProgress | None:
        """get current export status."""
        return self._exports.get(export_id)

    async def subscribe(self, export_id: str) -> asyncio.Queue:
        """subscribe to export progress updates."""
        if export_id not in self._listeners:
            self._listeners[export_id] = []

        queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_PROGRESS_QUEUE_SIZE)
        self._listeners[export_id].append(queue)

        # send current status immediately
        if export_id in self._exports:
            await queue.put(self._exports[export_id].to_dict())

        return queue

    def unsubscribe(self, export_id: str, queue: asyncio.Queue) -> None:
        """unsubscribe from export progress."""
        if export_id in self._listeners:
            with contextlib.suppress(ValueError):
                self._listeners[export_id].remove(queue)

    def cleanup_old_exports(self, max_age_seconds: int = 3600) -> None:
        """remove exports older than max_age_seconds."""
        now = datetime.now(UTC)
        to_remove = []

        for export_id, export in self._exports.items():
            if export.completed_at:
                age = (now - export.completed_at).total_seconds()
                if age > max_age_seconds:
                    to_remove.append(export_id)

        for export_id in to_remove:
            del self._exports[export_id]
            if export_id in self._listeners:
                del self._listeners[export_id]
            if export_id in self._export_data:
                del self._export_data[export_id]


# global tracker instance
export_tracker = ExportTracker()

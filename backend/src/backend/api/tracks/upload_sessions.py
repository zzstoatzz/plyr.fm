"""resumable track uploads: start → parts → finish.

the single-request `POST /tracks/` holds one HTTP request open for the
whole transfer and then stages the bytes to storage before answering, so a
large file means one very long request with nothing to show after the last
byte. a session splits the transfer into fixed-size parts that land straight
in an R2 multipart upload; each part is a short request the client can time
out, retry and report on independently, and `finish` answers as soon as the
parts are assembled. the worker then settles the staged bytes
(`uploads._settle_staged_audio`) and runs the ordinary upload pipeline.
"""

import contextlib
import math
from dataclasses import dataclass
from typing import Annotated

import logfire
from botocore.exceptions import ClientError
from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from backend._internal import Session as AuthSession
from backend._internal import require_artist_profile
from backend._internal.jobs import job_service
from backend.config import settings
from backend.models.job import Job, JobStatus, JobType
from backend.storage import storage
from backend.storage.keys import StagedUploadKey
from backend.utilities.audio_formats import AudioFormat
from backend.utilities.rate_limit import limiter

from .router import router
from .uploads import (
    UploadContext,
    UploadStartResponse,
    parse_upload_metadata,
    schedule_track_upload,
    stage_image_from_upload,
)

PART_SIZE_BYTES = 10 * 1024 * 1024
MAX_PARTS = 1_000
TRANSFER_PHASE = "transfer"


class UploadSessionStart(BaseModel):
    filename: str = Field(min_length=1)
    size_bytes: int = Field(gt=0)


class UploadSessionState(BaseModel):
    upload_id: str
    part_size_bytes: int
    part_count: int
    received_parts: list[int]


class UploadPartReceipt(BaseModel):
    part_number: int
    etag: str


@dataclass(frozen=True)
class TransferState:
    """what the job row remembers about an open transfer (`Job.result["transfer"]`)."""

    multipart_id: str
    filename: str
    extension: str
    size_bytes: int
    part_size_bytes: int
    part_count: int

    def expected_part_size(self, part_number: int) -> int:
        if part_number < self.part_count:
            return self.part_size_bytes
        return self.size_bytes - self.part_size_bytes * (self.part_count - 1)

    def as_result(self) -> dict[str, dict[str, str | int]]:
        return {
            "transfer": {
                "multipart_id": self.multipart_id,
                "filename": self.filename,
                "extension": self.extension,
                "size_bytes": self.size_bytes,
                "part_size_bytes": self.part_size_bytes,
                "part_count": self.part_count,
            }
        }

    @classmethod
    def from_job(cls, job: Job) -> "TransferState | None":
        transfer = (job.result or {}).get("transfer")
        if not isinstance(transfer, dict):
            return None
        return cls(
            multipart_id=str(transfer["multipart_id"]),
            filename=str(transfer["filename"]),
            extension=str(transfer["extension"]),
            size_bytes=int(transfer["size_bytes"]),
            part_size_bytes=int(transfer["part_size_bytes"]),
            part_count=int(transfer["part_count"]),
        )


def _staged(upload_id: str, transfer: TransferState) -> StagedUploadKey:
    return StagedUploadKey(upload_id=upload_id, extension=transfer.extension)


async def _open_transfer(upload_id: str, did: str) -> tuple[Job, TransferState]:
    """the caller's own upload session, still in the transfer phase."""
    job = await job_service.get_job(upload_id)
    if job is None or job.owner_did != did or job.type != JobType.UPLOAD.value:
        raise HTTPException(status_code=404, detail="upload session not found")
    transfer = TransferState.from_job(job)
    if (
        transfer is None
        or job.phase != TRANSFER_PHASE
        or job.status != JobStatus.PENDING.value
    ):
        raise HTTPException(status_code=409, detail="upload session is not open")
    return job, transfer


@router.post("/uploads")
@limiter.limit(settings.rate_limit.upload_limit)
async def start_upload_session(
    request: Request,
    body: UploadSessionStart,
    auth_session: AuthSession = Depends(require_artist_profile),
) -> UploadSessionState:
    """open a resumable upload; the bytes arrive through `PUT .../parts/{n}`."""
    extension = body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else ""
    if AudioFormat.from_extension(f".{extension}") is None:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported file type: .{extension}. "
            f"supported: {AudioFormat.supported_extensions_str()}",
        )
    max_size = settings.storage.max_upload_size_mb * 1024 * 1024
    if body.size_bytes > max_size:
        raise HTTPException(
            status_code=413,
            detail=f"file too large (max {settings.storage.max_upload_size_mb}MB)",
        )
    part_count = math.ceil(body.size_bytes / PART_SIZE_BYTES)
    if part_count > MAX_PARTS:
        raise HTTPException(status_code=413, detail="file has too many parts")

    upload_id = await job_service.create_job(
        JobType.UPLOAD, auth_session.did, "waiting for your file..."
    )
    staged = StagedUploadKey(upload_id=upload_id, extension=extension)
    multipart_id = await storage.begin_staged_upload(staged)
    transfer = TransferState(
        multipart_id=multipart_id,
        filename=body.filename,
        extension=extension,
        size_bytes=body.size_bytes,
        part_size_bytes=PART_SIZE_BYTES,
        part_count=part_count,
    )
    await job_service.update_progress(
        upload_id,
        JobStatus.PENDING,
        "uploading your file...",
        phase=TRANSFER_PHASE,
        result=transfer.as_result(),
    )
    logfire.info(
        "upload session opened",
        upload_id=upload_id,
        size_bytes=body.size_bytes,
        part_count=part_count,
    )
    return UploadSessionState(
        upload_id=upload_id,
        part_size_bytes=PART_SIZE_BYTES,
        part_count=part_count,
        received_parts=[],
    )


@router.get("/uploads/{upload_id}")
async def get_upload_session(
    upload_id: str,
    auth_session: AuthSession = Depends(require_artist_profile),
) -> UploadSessionState:
    """which parts have landed — what a client needs to resume after a drop."""
    _, transfer = await _open_transfer(upload_id, auth_session.did)
    received = await storage.staged_part_numbers(
        _staged(upload_id, transfer), transfer.multipart_id
    )
    return UploadSessionState(
        upload_id=upload_id,
        part_size_bytes=transfer.part_size_bytes,
        part_count=transfer.part_count,
        received_parts=received,
    )


@router.put("/uploads/{upload_id}/parts/{part_number}")
async def put_upload_part(
    upload_id: str,
    part_number: int,
    request: Request,
    auth_session: AuthSession = Depends(require_artist_profile),
) -> UploadPartReceipt:
    """one fixed-size slice of the file; re-sending a part number replaces it."""
    _, transfer = await _open_transfer(upload_id, auth_session.did)
    if not 1 <= part_number <= transfer.part_count:
        raise HTTPException(
            status_code=400,
            detail=f"part_number must be between 1 and {transfer.part_count}",
        )
    body = await request.body()
    expected = transfer.expected_part_size(part_number)
    if len(body) != expected:
        raise HTTPException(
            status_code=400,
            detail=f"part {part_number} must be {expected} bytes, got {len(body)}",
        )
    etag = await storage.put_staged_part(
        _staged(upload_id, transfer), transfer.multipart_id, part_number, body
    )
    await job_service.heartbeat(upload_id)
    return UploadPartReceipt(part_number=part_number, etag=etag)


@router.post("/uploads/{upload_id}/finish")
async def finish_upload_session(
    upload_id: str,
    request: Request,
    title: Annotated[str, Form()],
    auth_session: AuthSession = Depends(require_artist_profile),
    album: Annotated[str | None, Form()] = None,
    album_id: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,
    tags: Annotated[str | None, Form()] = None,
    visibility: Annotated[str, Form()] = "public",
    copyright: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    self_labels: Annotated[str | None, Form()] = None,
    auto_tag: Annotated[str | None, Form()] = None,
    image: UploadFile | None = File(None),
) -> UploadStartResponse:
    """assemble the parts and queue the track; same fields as `POST /tracks/` minus `file`.

    a missing part (409) or a rejected cover image (413) leaves the session
    open so the client can fix and retry; the multipart is only completed
    once nothing else can refuse the upload.
    """
    _, transfer = await _open_transfer(upload_id, auth_session.did)
    meta = parse_upload_metadata(
        auth_session,
        filename=transfer.filename,
        title=title,
        album=album,
        album_id=album_id,
        features=features,
        tags=tags,
        visibility=visibility,
        copyright=copyright,
        description=description,
        self_labels=self_labels,
        auto_tag=auto_tag,
    )
    staged = _staged(upload_id, transfer)

    received = await storage.staged_part_numbers(staged, transfer.multipart_id)
    missing = sorted(set(range(1, transfer.part_count + 1)) - set(received))
    if missing:
        logfire.info(
            "upload session incomplete", upload_id=upload_id, missing=missing[:20]
        )
        raise HTTPException(
            status_code=409,
            detail=f"upload incomplete — {len(missing)} part(s) missing",
        )

    image_id, image_url, thumbnail_url = await stage_image_from_upload(
        image, is_private=meta.is_private
    )

    enqueued = False
    try:
        try:
            size = await storage.complete_staged_upload(staged, transfer.multipart_id)
        except (ClientError, ValueError) as e:
            logfire.info("upload session incomplete", upload_id=upload_id, error=str(e))
            raise HTTPException(
                status_code=409, detail="upload incomplete — some parts are missing"
            ) from e
        if size != transfer.size_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"uploaded {size} bytes but {transfer.size_bytes} were declared",
            )
        ctx = UploadContext(
            upload_id=upload_id,
            auth_session=auth_session,
            audio_file_id="",
            filename=transfer.filename,
            duration=None,
            title=meta.title,
            artist_did=auth_session.did,
            album=meta.album,
            album_id=meta.album_id,
            features_json=meta.features_json,
            tags=meta.tags,
            self_labels=meta.self_labels,
            description=meta.description,
            image_id=image_id,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            support_gate=meta.support_gate,
            copyright_rights=meta.copyright_rights,
            auto_tag=meta.auto_tag,
            visibility=meta.visibility,
            staged=True,
        )
        await job_service.update_progress(
            upload_id,
            JobStatus.PENDING,
            "upload queued for processing",
            phase="queued",
            progress_pct=0.0,
        )
        await schedule_track_upload(ctx)
        enqueued = True
    finally:
        if not enqueued:
            with contextlib.suppress(Exception):
                await storage.delete_staged(staged)
            if image_id:
                with contextlib.suppress(Exception):
                    await storage.discard_staged(image_id)
            with contextlib.suppress(Exception):
                await job_service.update_progress(
                    upload_id,
                    JobStatus.FAILED,
                    "upload failed",
                    error="upload aborted before queueing",
                )

    return UploadStartResponse(
        upload_id=upload_id,
        status="pending",
        message="upload queued for processing",
    )

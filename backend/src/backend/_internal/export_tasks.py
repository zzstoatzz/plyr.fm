"""background tasks for media exports."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

import aioboto3
import aiofiles
import logfire
from sqlalchemy import select

from backend._internal.background import get_docket
from backend._internal.jobs import job_service
from backend.config import settings
from backend.models import Track
from backend.models.job import JobStatus
from backend.storage.r2 import UploadProgressTracker
from backend.utilities.database import db_session
from backend.utilities.progress import R2ProgressTracker

logger = logging.getLogger(__name__)


async def process_export(export_id: str, artist_did: str) -> None:
    """process a media export in the background.

    downloads all tracks for the given artist concurrently, zips them,
    and uploads to R2. progress is tracked via job_service.

    args:
        export_id: job ID for tracking progress
        artist_did: DID of the artist whose tracks to export
    """
    try:
        await job_service.update_progress(
            export_id, JobStatus.PROCESSING, "fetching tracks..."
        )

        # query all tracks for the user
        async with db_session() as db:
            stmt = (
                select(Track)
                .where(Track.artist_did == artist_did)
                .order_by(Track.created_at)
            )
            result = await db.execute(stmt)
            tracks = result.scalars().all()

        if not tracks:
            await job_service.update_progress(
                export_id,
                JobStatus.FAILED,
                "export failed",
                error="no tracks found to export",
            )
            return

        # use temp directory to avoid loading large files into memory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            zip_path = temp_path / f"{export_id}.zip"
            async_session = aioboto3.Session()

            # prepare track metadata before downloading
            title_counts: dict[str, int] = {}
            track_info: list[dict] = []

            for track in tracks:
                if not track.file_id or not track.file_type:
                    logfire.warn(
                        "skipping track: missing file_id or file_type",
                        track_id=track.id,
                    )
                    continue

                # prefer original file for export (lossless if available)
                if track.original_file_id and track.original_file_type:
                    export_file_id = track.original_file_id
                    export_file_type = track.original_file_type
                else:
                    export_file_id = track.file_id
                    export_file_type = track.file_type

                # create safe filename with duplicate handling
                base_filename = f"{track.title}.{export_file_type}"
                if base_filename in title_counts:
                    title_counts[base_filename] += 1
                    filename = f"{track.title} ({title_counts[base_filename]}).{export_file_type}"
                else:
                    title_counts[base_filename] = 0
                    filename = base_filename

                # sanitize filename (remove invalid chars)
                filename = "".join(
                    c
                    for c in filename
                    if c.isalnum() or c in (" ", ".", "-", "_", "(", ")")
                )

                track_info.append(
                    {
                        "track": track,
                        "key": f"audio/{export_file_id}.{export_file_type}",
                        "filename": filename,
                        "temp_path": temp_path / filename,
                    }
                )

            total = len(track_info)
            if total == 0:
                await job_service.update_progress(
                    export_id,
                    JobStatus.FAILED,
                    "export failed",
                    error="no valid tracks found to export",
                )
                return

            # download counter for progress updates
            downloaded = 0
            download_lock = asyncio.Lock()

            async def download_track(
                info: dict,
                s3_client,
                semaphore: asyncio.Semaphore,
            ) -> dict | None:
                """download a single track, returning info on success or None on failure."""
                nonlocal downloaded

                async with semaphore:
                    track = info["track"]
                    try:
                        response = await s3_client.get_object(
                            Bucket=settings.storage.r2_bucket,
                            Key=info["key"],
                        )

                        # stream to disk in chunks
                        async with aiofiles.open(info["temp_path"], "wb") as f:
                            async for chunk in response["Body"].iter_chunks():
                                await f.write(chunk)

                        # update progress
                        async with download_lock:
                            downloaded += 1
                            pct = (downloaded / total) * 100
                            await job_service.update_progress(
                                export_id,
                                JobStatus.PROCESSING,
                                f"downloading tracks ({downloaded}/{total})...",
                                progress_pct=pct,
                                result={
                                    "processed_count": downloaded,
                                    "total_count": total,
                                },
                            )

                        logfire.info(
                            "downloaded track: {track_title}",
                            track_id=track.id,
                            track_title=track.title,
                        )
                        return info

                    except Exception as e:
                        logfire.error(
                            "failed to download track: {track_title}",
                            track_id=track.id,
                            track_title=track.title,
                            error=str(e),
                            _exc_info=True,
                        )
                        return None

            # download all tracks concurrently (limit to 4 concurrent downloads)
            await job_service.update_progress(
                export_id,
                JobStatus.PROCESSING,
                f"downloading {total} tracks...",
                progress_pct=0.0,
                result={"processed_count": 0, "total_count": total},
            )

            semaphore = asyncio.Semaphore(4)
            async with async_session.client(
                "s3",
                endpoint_url=settings.storage.r2_endpoint_url,
                aws_access_key_id=settings.storage.aws_access_key_id,
                aws_secret_access_key=settings.storage.aws_secret_access_key,
            ) as s3_client:
                results = await asyncio.gather(
                    *[download_track(info, s3_client, semaphore) for info in track_info]
                )

            # filter out failed downloads
            successful_downloads = [r for r in results if r is not None]

            # create zip file from downloaded tracks (sequential - zipfile not thread-safe)
            await job_service.update_progress(
                export_id,
                JobStatus.PROCESSING,
                "creating zip archive...",
                progress_pct=100.0,
                result={
                    "processed_count": len(successful_downloads),
                    "total_count": total,
                },
            )

            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
                for info in successful_downloads:
                    zip_file.write(info["temp_path"], arcname=info["filename"])
                    logfire.info(
                        "added track to export: {track_title}",
                        track_id=info["track"].id,
                        track_title=info["track"].title,
                        filename=info["filename"],
                    )
                    # remove temp file to free disk space
                    os.unlink(info["temp_path"])

            processed = len(successful_downloads)

            # upload the zip file to R2 (still inside temp directory context)
            r2_key = f"exports/{export_id}.zip"

            try:
                zip_size = zip_path.stat().st_size

                # Generate user-friendly filename for download
                download_filename = f"plyr-tracks-{datetime.now().date()}.zip"

                async with (
                    R2ProgressTracker(
                        job_id=export_id,
                        message="finalizing export...",
                        phase="upload",
                    ) as tracker,
                    async_session.client(
                        "s3",
                        endpoint_url=settings.storage.r2_endpoint_url,
                        aws_access_key_id=settings.storage.aws_access_key_id,
                        aws_secret_access_key=settings.storage.aws_secret_access_key,
                    ) as upload_client,
                ):
                    # Wrap callback with UploadProgressTracker to convert bytes to percentage
                    bytes_to_pct = UploadProgressTracker(zip_size, tracker.on_progress)
                    with open(zip_path, "rb") as zip_file_obj:
                        await upload_client.upload_fileobj(
                            zip_file_obj,
                            settings.storage.r2_bucket,
                            r2_key,
                            ExtraArgs={
                                "ContentType": "application/zip",
                                "ContentDisposition": f'attachment; filename="{download_filename}"',
                            },
                            Callback=bytes_to_pct,
                        )

                # Final 100% update
                await job_service.update_progress(
                    export_id,
                    JobStatus.PROCESSING,
                    "finalizing export...",
                    phase="upload",
                    progress_pct=100.0,
                )

            except Exception as e:
                logfire.error("failed to upload export zip", error=str(e))
                raise

            # get download URL
            download_url = f"{settings.storage.r2_public_bucket_url}/{r2_key}"

            # mark as completed
            await job_service.update_progress(
                export_id,
                JobStatus.COMPLETED,
                f"export completed - {processed} tracks ready",
                result={
                    "processed_count": processed,
                    "total_count": len(tracks),
                    "download_url": download_url,
                },
            )

    except Exception as e:
        logfire.exception(
            "export failed with unexpected error",
            export_id=export_id,
        )
        await job_service.update_progress(
            export_id,
            JobStatus.FAILED,
            "export failed",
            error=f"unexpected error: {e!s}",
        )


async def schedule_export(export_id: str, artist_did: str) -> None:
    """schedule an export via docket."""
    docket = get_docket()
    await docket.add(process_export)(export_id, artist_did)
    logfire.info("scheduled export", export_id=export_id)

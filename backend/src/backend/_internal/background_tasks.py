"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.

requires DOCKET_URL to be set (Redis is always available).
"""

import logging
import os
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

import aioboto3
import aiofiles
import logfire

from backend._internal.background import get_docket

logger = logging.getLogger(__name__)


async def scan_copyright(track_id: int, audio_url: str) -> None:
    """scan a track for potential copyright matches.

    args:
        track_id: database ID of the track to scan
        audio_url: public URL of the audio file (R2)
    """
    from backend._internal.moderation import scan_track_for_copyright

    await scan_track_for_copyright(track_id, audio_url)


async def schedule_copyright_scan(track_id: int, audio_url: str) -> None:
    """schedule a copyright scan via docket."""
    docket = get_docket()
    await docket.add(scan_copyright)(track_id, audio_url)
    logfire.info("scheduled copyright scan", track_id=track_id)


async def process_export(export_id: str, artist_did: str) -> None:
    """process a media export in the background.

    downloads all tracks for the given artist, zips them, and uploads
    to R2. progress is tracked via job_service.

    args:
        export_id: job ID for tracking progress
        artist_did: DID of the artist whose tracks to export
    """
    from sqlalchemy import select

    from backend._internal.jobs import job_service
    from backend.config import settings
    from backend.models import Track
    from backend.models.job import JobStatus
    from backend.storage.r2 import UploadProgressTracker
    from backend.utilities.database import db_session
    from backend.utilities.progress import R2ProgressTracker

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

            async with async_session.client(
                "s3",
                endpoint_url=settings.storage.r2_endpoint_url,
                aws_access_key_id=settings.storage.aws_access_key_id,
                aws_secret_access_key=settings.storage.aws_secret_access_key,
            ) as s3_client:
                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
                    # track counter for duplicate titles
                    title_counts: dict[str, int] = {}
                    processed = 0
                    total = len(tracks)

                    for track in tracks:
                        if not track.file_id or not track.file_type:
                            logfire.warn(
                                "skipping track: missing file_id or file_type",
                                track_id=track.id,
                            )
                            continue

                        # construct R2 key
                        key = f"audio/{track.file_id}.{track.file_type}"

                        try:
                            # update progress (current_track is 1-indexed for display)
                            current_track = processed + 1
                            pct = (processed / total) * 100
                            await job_service.update_progress(
                                export_id,
                                JobStatus.PROCESSING,
                                f"downloading track {current_track} of {total}...",
                                progress_pct=pct,
                                result={
                                    "processed_count": processed,
                                    "total_count": total,
                                    "current_track": current_track,
                                    "current_title": track.title,
                                },
                            )

                            # create safe filename
                            # handle duplicate titles by appending counter
                            base_filename = f"{track.title}.{track.file_type}"
                            if base_filename in title_counts:
                                title_counts[base_filename] += 1
                                filename = f"{track.title} ({title_counts[base_filename]}).{track.file_type}"
                            else:
                                title_counts[base_filename] = 0
                                filename = base_filename

                            # sanitize filename (remove invalid chars)
                            filename = "".join(
                                c
                                for c in filename
                                if c.isalnum() or c in (" ", ".", "-", "_", "(", ")")
                            )

                            # download file to temp location, streaming to disk
                            temp_file_path = temp_path / filename
                            response = await s3_client.get_object(
                                Bucket=settings.storage.r2_bucket,
                                Key=key,
                            )

                            # stream to disk in chunks to avoid loading into memory
                            async with aiofiles.open(temp_file_path, "wb") as f:
                                async for chunk in response["Body"].iter_chunks():
                                    await f.write(chunk)

                            # add to zip from disk (streams from file, doesn't load into memory)
                            zip_file.write(temp_file_path, arcname=filename)

                            # remove temp file immediately to free disk space
                            os.unlink(temp_file_path)

                            processed += 1
                            logfire.info(
                                "added track to export: {track_title}",
                                track_id=track.id,
                                track_title=track.title,
                                filename=filename,
                            )

                        except Exception as e:
                            logfire.error(
                                "failed to add track to export: {track_title}",
                                track_id=track.id,
                                track_title=track.title,
                                error=str(e),
                                _exc_info=True,
                            )
                            # continue with other tracks instead of failing entire export

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


async def sync_atproto(session_id: str, user_did: str) -> None:
    """sync ATProto records (profile, albums, liked tracks) for a user.

    this runs after login or scope upgrade to ensure the user's PDS
    has up-to-date records for their plyr.fm data.

    args:
        session_id: the user's session ID for authentication
        user_did: the user's DID
    """
    from backend._internal.atproto.sync import sync_atproto_records
    from backend._internal.auth import get_session

    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"sync_atproto: session {session_id[:8]}... not found")
        return

    await sync_atproto_records(auth_session, user_did)


async def schedule_atproto_sync(session_id: str, user_did: str) -> None:
    """schedule an ATProto sync via docket."""
    docket = get_docket()
    await docket.add(sync_atproto)(session_id, user_did)
    logfire.info("scheduled atproto sync", user_did=user_did)


async def scrobble_to_teal(
    session_id: str,
    track_id: int,
    track_title: str,
    artist_name: str,
    duration: int | None,
    album_name: str | None,
) -> None:
    """scrobble a play to teal.fm (creates play record + updates status).

    args:
        session_id: the user's session ID for authentication
        track_id: database ID of the track
        track_title: title of the track
        artist_name: name of the artist
        duration: track duration in seconds
        album_name: album name (optional)
    """
    from backend._internal.atproto.teal import (
        create_teal_play_record,
        update_teal_status,
    )
    from backend._internal.auth import get_session
    from backend.config import settings

    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"teal scrobble: session {session_id[:8]}... not found")
        return

    origin_url = f"{settings.frontend.url}/track/{track_id}"

    try:
        # create play record (scrobble)
        play_uri = await create_teal_play_record(
            auth_session=auth_session,
            track_name=track_title,
            artist_name=artist_name,
            duration=duration,
            album_name=album_name,
            origin_url=origin_url,
        )
        logger.info(f"teal play record created: {play_uri}")

        # update status (now playing)
        status_uri = await update_teal_status(
            auth_session=auth_session,
            track_name=track_title,
            artist_name=artist_name,
            duration=duration,
            album_name=album_name,
            origin_url=origin_url,
        )
        logger.info(f"teal status updated: {status_uri}")

    except Exception as e:
        logger.error(f"teal scrobble failed for track {track_id}: {e}", exc_info=True)


async def schedule_teal_scrobble(
    session_id: str,
    track_id: int,
    track_title: str,
    artist_name: str,
    duration: int | None,
    album_name: str | None,
) -> None:
    """schedule a teal scrobble via docket."""
    docket = get_docket()
    await docket.add(scrobble_to_teal)(
        session_id, track_id, track_title, artist_name, duration, album_name
    )
    logfire.info("scheduled teal scrobble", track_id=track_id)

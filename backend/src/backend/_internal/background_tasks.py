"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.

requires DOCKET_URL to be set (Redis is always available).
"""

import asyncio
import logging
import os
import tempfile
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import aioboto3
import aiofiles
import logfire
from docket import Perpetual
from sqlalchemy import select

from backend._internal.atproto.records import (
    create_comment_record,
    create_like_record,
    delete_record_by_uri,
    update_comment_record,
)
from backend._internal.auth import get_session
from backend._internal.background import get_docket
from backend.models import CopyrightScan, Track, TrackComment, TrackLike
from backend.utilities.database import db_session

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


async def sync_copyright_resolutions(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=5), automatic=True),  # noqa: B008
) -> None:
    """sync resolution status from labeler to backend database.

    finds tracks that are flagged but have no resolution, checks the labeler
    to see if the labels were negated (dismissed), and marks them as resolved.

    this replaces the lazy reconciliation that was happening on read paths.
    runs automatically every 5 minutes via docket's Perpetual.
    """
    from backend._internal.moderation_client import get_moderation_client

    async with db_session() as db:
        # find flagged scans with AT URIs that haven't been resolved
        result = await db.execute(
            select(CopyrightScan, Track.atproto_record_uri)
            .join(Track, CopyrightScan.track_id == Track.id)
            .where(
                CopyrightScan.is_flagged == True,  # noqa: E712
                Track.atproto_record_uri.isnot(None),
            )
        )
        rows = result.all()

        if not rows:
            logfire.debug("sync_copyright_resolutions: no flagged scans to check")
            return

        # batch check with labeler
        scan_by_uri: dict[str, CopyrightScan] = {}
        for scan, uri in rows:
            if uri:
                scan_by_uri[uri] = scan

        if not scan_by_uri:
            return

        client = get_moderation_client()
        active_uris = await client.get_active_labels(list(scan_by_uri.keys()))

        # find scans that are no longer active (label was negated)
        resolved_count = 0
        for uri, scan in scan_by_uri.items():
            if uri not in active_uris:
                # label was negated - track is no longer flagged
                scan.is_flagged = False
                resolved_count += 1

        if resolved_count > 0:
            await db.commit()
            logfire.info(
                "sync_copyright_resolutions: resolved {count} scans",
                count=resolved_count,
            )
        else:
            logfire.debug(
                "sync_copyright_resolutions: checked {count} scans, none resolved",
                count=len(scan_by_uri),
            )


async def schedule_copyright_resolution_sync() -> None:
    """schedule a copyright resolution sync via docket."""
    docket = get_docket()
    await docket.add(sync_copyright_resolutions)()
    logfire.info("scheduled copyright resolution sync")


async def process_export(export_id: str, artist_did: str) -> None:
    """process a media export in the background.

    downloads all tracks for the given artist concurrently, zips them,
    and uploads to R2. progress is tracked via job_service.

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

                # create safe filename with duplicate handling
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

                track_info.append(
                    {
                        "track": track,
                        "key": f"audio/{track.file_id}.{track.file_type}",
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


async def sync_album_list(session_id: str, album_id: str) -> None:
    """sync a single album's ATProto list record.

    creates or updates the album's list record on the user's PDS.
    called after track uploads or album mutations.

    args:
        session_id: the user's session ID for authentication
        album_id: the album's database ID
    """
    from sqlalchemy import select

    from backend._internal.atproto.records.fm_plyr import upsert_album_list_record
    from backend._internal.auth import get_session
    from backend.models import Album, Track
    from backend.utilities.database import db_session

    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"sync_album_list: session {session_id[:8]}... not found")
        return

    async with db_session() as session:
        # fetch album
        album_result = await session.execute(select(Album).where(Album.id == album_id))
        album = album_result.scalar_one_or_none()
        if not album:
            logger.warning(f"sync_album_list: album {album_id} not found")
            return

        # verify album belongs to this user
        if album.artist_did != auth_session.did:
            logger.warning(
                f"sync_album_list: album {album_id} does not belong to {auth_session.did}"
            )
            return

        # fetch tracks with ATProto records
        tracks_result = await session.execute(
            select(Track)
            .where(
                Track.album_id == album_id,
                Track.atproto_record_uri.isnot(None),
                Track.atproto_record_cid.isnot(None),
            )
            .order_by(Track.created_at.asc())
        )
        tracks = tracks_result.scalars().all()

        if not tracks:
            logger.debug(
                f"sync_album_list: album {album_id} has no tracks with ATProto records"
            )
            return

        track_refs = [
            {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid} for t in tracks
        ]

        try:
            result = await upsert_album_list_record(
                auth_session,
                album_id=album_id,
                album_title=album.title,
                track_refs=track_refs,
                existing_uri=album.atproto_record_uri,
                existing_created_at=album.created_at,
            )
            if result:
                album.atproto_record_uri = result[0]
                album.atproto_record_cid = result[1]
                await session.commit()
                logger.info(f"synced album list record for {album_id}: {result[0]}")
        except Exception as e:
            logger.warning(f"failed to sync album list record for {album_id}: {e}")


async def schedule_album_list_sync(session_id: str, album_id: str) -> None:
    """schedule an album list sync via docket."""
    docket = get_docket()
    await docket.add(sync_album_list)(session_id, album_id)
    logfire.info("scheduled album list sync", album_id=album_id)


# ---------------------------------------------------------------------------
# PDS record write tasks
#
# these tasks handle writing records to the user's PDS (Personal Data Server)
# in the background, then updating the local database with the result.
# this keeps API responses fast while ensuring PDS and DB stay in sync.
# ---------------------------------------------------------------------------


async def pds_create_like(
    session_id: str,
    like_id: int,
    subject_uri: str,
    subject_cid: str,
) -> None:
    """create a like record on the user's PDS and update the database.

    args:
        session_id: the user's session ID for authentication
        like_id: database ID of the TrackLike record to update
        subject_uri: AT URI of the track being liked
        subject_cid: CID of the track being liked
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_create_like: session {session_id[:8]}... not found")
        return

    try:
        like_uri = await create_like_record(
            auth_session=auth_session,
            subject_uri=subject_uri,
            subject_cid=subject_cid,
        )

        # update database with the ATProto URI
        async with db_session() as session:
            result = await session.execute(
                select(TrackLike).where(TrackLike.id == like_id)
            )
            like = result.scalar_one_or_none()
            if like:
                like.atproto_like_uri = like_uri
                await session.commit()
                logger.info(f"pds_create_like: created like record {like_uri}")
            else:
                # like was deleted before we could update it - clean up orphan
                logger.warning(f"pds_create_like: like {like_id} no longer exists")
                await delete_record_by_uri(auth_session, like_uri)

    except Exception as e:
        logger.error(f"pds_create_like failed for like {like_id}: {e}", exc_info=True)
        # note: we don't delete the DB record on failure - user still sees "liked"
        # and we can retry or fix later. this is better than inconsistent state.


async def schedule_pds_create_like(
    session_id: str,
    like_id: int,
    subject_uri: str,
    subject_cid: str,
) -> None:
    """schedule a like record creation via docket."""
    docket = get_docket()
    await docket.add(pds_create_like)(session_id, like_id, subject_uri, subject_cid)
    logfire.info("scheduled pds like creation", like_id=like_id)


async def pds_delete_like(
    session_id: str,
    like_uri: str,
) -> None:
    """delete a like record from the user's PDS.

    args:
        session_id: the user's session ID for authentication
        like_uri: AT URI of the like record to delete
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_delete_like: session {session_id[:8]}... not found")
        return

    try:
        await delete_record_by_uri(auth_session, like_uri)
        logger.info(f"pds_delete_like: deleted like record {like_uri}")
    except Exception as e:
        logger.error(f"pds_delete_like failed for {like_uri}: {e}", exc_info=True)
        # deletion failed - the PDS record may still exist, but DB is already clean
        # this is acceptable: orphaned PDS records are harmless


async def schedule_pds_delete_like(session_id: str, like_uri: str) -> None:
    """schedule a like record deletion via docket."""
    docket = get_docket()
    await docket.add(pds_delete_like)(session_id, like_uri)
    logfire.info("scheduled pds like deletion", like_uri=like_uri)


async def pds_create_comment(
    session_id: str,
    comment_id: int,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
) -> None:
    """create a comment record on the user's PDS and update the database.

    args:
        session_id: the user's session ID for authentication
        comment_id: database ID of the TrackComment record to update
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: comment text
        timestamp_ms: playback position when comment was made
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_create_comment: session {session_id[:8]}... not found")
        return

    try:
        comment_uri = await create_comment_record(
            auth_session=auth_session,
            subject_uri=subject_uri,
            subject_cid=subject_cid,
            text=text,
            timestamp_ms=timestamp_ms,
        )

        # update database with the ATProto URI
        async with db_session() as session:
            result = await session.execute(
                select(TrackComment).where(TrackComment.id == comment_id)
            )
            comment = result.scalar_one_or_none()
            if comment:
                comment.atproto_comment_uri = comment_uri
                await session.commit()
                logger.info(f"pds_create_comment: created comment record {comment_uri}")
            else:
                # comment was deleted before we could update it - clean up orphan
                logger.warning(
                    f"pds_create_comment: comment {comment_id} no longer exists"
                )
                await delete_record_by_uri(auth_session, comment_uri)

    except Exception as e:
        logger.error(
            f"pds_create_comment failed for comment {comment_id}: {e}", exc_info=True
        )


async def schedule_pds_create_comment(
    session_id: str,
    comment_id: int,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
) -> None:
    """schedule a comment record creation via docket."""
    docket = get_docket()
    await docket.add(pds_create_comment)(
        session_id, comment_id, subject_uri, subject_cid, text, timestamp_ms
    )
    logfire.info("scheduled pds comment creation", comment_id=comment_id)


async def pds_delete_comment(
    session_id: str,
    comment_uri: str,
) -> None:
    """delete a comment record from the user's PDS.

    args:
        session_id: the user's session ID for authentication
        comment_uri: AT URI of the comment record to delete
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_delete_comment: session {session_id[:8]}... not found")
        return

    try:
        await delete_record_by_uri(auth_session, comment_uri)
        logger.info(f"pds_delete_comment: deleted comment record {comment_uri}")
    except Exception as e:
        logger.error(f"pds_delete_comment failed for {comment_uri}: {e}", exc_info=True)


async def schedule_pds_delete_comment(session_id: str, comment_uri: str) -> None:
    """schedule a comment record deletion via docket."""
    docket = get_docket()
    await docket.add(pds_delete_comment)(session_id, comment_uri)
    logfire.info("scheduled pds comment deletion", comment_uri=comment_uri)


async def pds_update_comment(
    session_id: str,
    comment_id: int,
    comment_uri: str,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
    created_at: datetime,
) -> None:
    """update a comment record on the user's PDS.

    args:
        session_id: the user's session ID for authentication
        comment_id: database ID of the TrackComment record
        comment_uri: AT URI of the comment record to update
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: new comment text
        timestamp_ms: playback position when comment was made
        created_at: original creation timestamp
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_update_comment: session {session_id[:8]}... not found")
        return

    try:
        await update_comment_record(
            auth_session=auth_session,
            comment_uri=comment_uri,
            subject_uri=subject_uri,
            subject_cid=subject_cid,
            text=text,
            timestamp_ms=timestamp_ms,
            created_at=created_at,
            updated_at=datetime.now(UTC),
        )
        logger.info(f"pds_update_comment: updated comment record {comment_uri}")
    except Exception as e:
        logger.error(
            f"pds_update_comment failed for comment {comment_id}: {e}", exc_info=True
        )


async def schedule_pds_update_comment(
    session_id: str,
    comment_id: int,
    comment_uri: str,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
    created_at: datetime,
) -> None:
    """schedule a comment record update via docket."""
    docket = get_docket()
    await docket.add(pds_update_comment)(
        session_id,
        comment_id,
        comment_uri,
        subject_uri,
        subject_cid,
        text,
        timestamp_ms,
        created_at,
    )
    logfire.info("scheduled pds comment update", comment_id=comment_id)


async def migrate_track_to_private_bucket(track_id: int) -> None:
    """migrate a track's audio file from public to private bucket.

    called when support_gate is enabled on an existing track.
    copies file to private bucket, deletes from public, clears r2_url.

    args:
        track_id: database ID of the track to migrate
    """
    from backend.models import Track
    from backend.storage import storage

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track_id))
        track = result.scalar_one_or_none()

        if not track:
            logger.warning(
                f"migrate_track_to_private_bucket: track {track_id} not found"
            )
            return

        if not track.file_id or not track.file_type:
            logger.warning(
                f"migrate_track_to_private_bucket: track {track_id} missing file_id/file_type"
            )
            return

        # migrate the file
        success = await storage.migrate_to_private_bucket(
            file_id=track.file_id,
            extension=track.file_type,
        )

        if success:
            # clear r2_url so the public URL is no longer used
            track.r2_url = None
            await db.commit()
            logger.info(f"migrated track {track_id} to private bucket")
        else:
            logger.error(f"failed to migrate track {track_id} to private bucket")


async def schedule_track_migration(track_id: int) -> None:
    """schedule a track migration to private bucket via docket."""
    docket = get_docket()
    await docket.add(migrate_track_to_private_bucket)(track_id)
    logfire.info("scheduled track migration to private bucket", track_id=track_id)


# collection of all background task functions for docket registration
background_tasks = [
    scan_copyright,
    sync_copyright_resolutions,
    process_export,
    sync_atproto,
    scrobble_to_teal,
    sync_album_list,
    pds_create_like,
    pds_delete_like,
    pds_create_comment,
    pds_delete_comment,
    pds_update_comment,
    migrate_track_to_private_bucket,
]

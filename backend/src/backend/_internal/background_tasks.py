"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.

requires DOCKET_URL to be set (Redis is always available).
"""

import logging
from datetime import UTC, datetime, timedelta

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
from backend._internal.export_tasks import process_export
from backend._internal.pds_backfill_tasks import backfill_tracks_to_pds
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
            {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
            for t in tracks
            if t.atproto_record_uri and t.atproto_record_cid
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


async def move_track_audio(track_id: int, to_private: bool) -> None:
    """move a track's audio file between public and private buckets.

    called when support_gate is toggled on an existing track.

    args:
        track_id: database ID of the track
        to_private: if True, move to private bucket; if False, move to public
    """
    from backend.models import Track
    from backend.storage import storage

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track_id))
        track = result.scalar_one_or_none()

        if not track:
            logger.warning(f"move_track_audio: track {track_id} not found")
            return

        if not track.file_id or not track.file_type:
            logger.warning(
                f"move_track_audio: track {track_id} missing file_id/file_type"
            )
            return

        result_url = await storage.move_audio(
            file_id=track.file_id,
            extension=track.file_type,
            to_private=to_private,
        )

        # update r2_url: None for private, public URL for public
        if to_private:
            # moved to private - result_url is None on success, None on failure
            # we check by verifying the file was actually moved (no error logged)
            track.r2_url = None
            await db.commit()
            logger.info(f"moved track {track_id} to private bucket")
        elif result_url:
            # moved to public - result_url is the public URL
            track.r2_url = result_url
            await db.commit()
            logger.info(f"moved track {track_id} to public bucket")
        else:
            logger.error(f"failed to move track {track_id}")


async def schedule_move_track_audio(track_id: int, to_private: bool) -> None:
    """schedule a track audio move via docket."""
    docket = get_docket()
    await docket.add(move_track_audio)(track_id, to_private)
    direction = "private" if to_private else "public"
    logfire.info(f"scheduled track audio move to {direction}", track_id=track_id)


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
    backfill_tracks_to_pds,
    move_track_audio,
]

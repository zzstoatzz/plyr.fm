"""ATProto sync and teal scrobble background tasks."""

import logging

import logfire
from sqlalchemy import select

from backend._internal.background import get_docket

logger = logging.getLogger(__name__)


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

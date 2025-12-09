"""high-level ATProto record synchronization."""

import logging

from sqlalchemy import select

from backend._internal import Session as AuthSession
from backend._internal.atproto.records.fm_plyr import (
    upsert_album_list_record,
    upsert_liked_list_record,
    upsert_profile_record,
)
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def sync_atproto_records(
    auth_session: AuthSession,
    user_did: str,
) -> None:
    """sync profile, albums, and liked tracks to ATProto.

    this is the actual sync logic - runs all queries and PDS calls.
    should be called from a background task to avoid blocking.
    """
    from backend.models import Album, Artist, Track, TrackLike, UserPreferences

    # sync profile record
    async with db_session() as session:
        artist_result = await session.execute(
            select(Artist).where(Artist.did == user_did)
        )
        artist = artist_result.scalar_one_or_none()
        artist_bio = artist.bio if artist else None

    if artist_bio is not None or artist:
        try:
            profile_result = await upsert_profile_record(auth_session, bio=artist_bio)
            if profile_result:
                logger.info(f"synced ATProto profile record for {user_did}")
        except Exception as e:
            logger.warning(f"failed to sync ATProto profile record for {user_did}: {e}")

    # query and sync album list records
    async with db_session() as session:
        albums_result = await session.execute(
            select(Album).where(Album.artist_did == user_did)
        )
        albums = albums_result.scalars().all()

        for album in albums:
            tracks_result = await session.execute(
                select(Track)
                .where(
                    Track.album_id == album.id,
                    Track.atproto_record_uri.isnot(None),
                    Track.atproto_record_cid.isnot(None),
                )
                .order_by(Track.created_at.asc())
            )
            tracks = tracks_result.scalars().all()

            if tracks:
                track_refs = [
                    {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
                    for t in tracks
                ]
                try:
                    album_result = await upsert_album_list_record(
                        auth_session,
                        album_id=album.id,
                        album_title=album.title,
                        track_refs=track_refs,
                        existing_uri=album.atproto_record_uri,
                    )
                    if album_result:
                        album.atproto_record_uri = album_result[0]
                        album.atproto_record_cid = album_result[1]
                        await session.commit()
                        logger.info(
                            f"synced album list record for {album.id}: {album_result[0]}"
                        )
                except Exception as e:
                    logger.warning(
                        f"failed to sync album list record for {album.id}: {e}"
                    )

    # query and sync liked tracks list record
    async with db_session() as session:
        prefs_result = await session.execute(
            select(UserPreferences).where(UserPreferences.did == user_did)
        )
        prefs = prefs_result.scalar_one_or_none()

        likes_result = await session.execute(
            select(Track)
            .join(TrackLike, TrackLike.track_id == Track.id)
            .where(
                TrackLike.user_did == user_did,
                Track.atproto_record_uri.isnot(None),
                Track.atproto_record_cid.isnot(None),
            )
            .order_by(TrackLike.created_at.desc())
        )
        liked_tracks = likes_result.scalars().all()

        if liked_tracks:
            liked_refs = [
                {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
                for t in liked_tracks
            ]
            existing_liked_uri = prefs.liked_list_uri if prefs else None

            try:
                liked_result = await upsert_liked_list_record(
                    auth_session,
                    track_refs=liked_refs,
                    existing_uri=existing_liked_uri,
                )
                if liked_result:
                    if prefs:
                        prefs.liked_list_uri = liked_result[0]
                        prefs.liked_list_cid = liked_result[1]
                    else:
                        prefs = UserPreferences(
                            did=user_did,
                            liked_list_uri=liked_result[0],
                            liked_list_cid=liked_result[1],
                        )
                        session.add(prefs)
                    await session.commit()
                    logger.info(
                        f"synced liked list record for {user_did}: {liked_result[0]}"
                    )
            except Exception as e:
                logger.warning(f"failed to sync liked list record for {user_did}: {e}")

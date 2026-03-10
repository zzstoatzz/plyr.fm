"""Jetstream event ingestion tasks.

each task resolves an ATProto record event into the database. they are
dispatched by the JetstreamConsumer via docket and run asynchronously.

all tasks are idempotent — duplicate events are safely skipped via
unique constraint checks or existence queries.
"""

import logging
from datetime import UTC, datetime

import logfire
from sqlalchemy import delete, select, update

from backend.models import Artist, Playlist, Track, TrackComment, TrackLike
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


def _parse_datetime(value: str | None) -> datetime:
    """parse an ISO 8601 datetime string, falling back to now."""
    if not value:
        return datetime.now(UTC)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, AttributeError):
        return datetime.now(UTC)


# --- track tasks ---


async def ingest_track_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None,
) -> None:
    """create a track from a Jetstream event.

    args:
        did: the DID of the artist
        rkey: record key
        record: the ATProto record data
        uri: the AT URI (at://did/collection/rkey)
        cid: content identifier
    """
    async with db_session() as db:
        # verify artist exists
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_track_create: unknown artist %s, skipping", did)
            return

        # dedup by AT URI
        existing = await db.execute(
            select(Track.id).where(Track.atproto_record_uri == uri).limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            logger.debug("ingest_track_create: duplicate URI %s, skipping", uri)
            return

        # determine audio storage type
        audio_blob = record.get("audioBlob")
        audio_url = record.get("audioUrl")
        if audio_blob:
            audio_storage = "pds"
            pds_blob_cid = (
                audio_blob.get("ref", {}).get("$link")
                if isinstance(audio_blob, dict)
                else None
            )
        elif audio_url:
            audio_storage = "r2"
            pds_blob_cid = None
        else:
            audio_storage = "pds"
            pds_blob_cid = None

        # build extra dict
        extra: dict = {}
        if duration := record.get("duration"):
            extra["duration"] = duration
        if album := record.get("album"):
            extra["album"] = album

        track = Track(
            title=record.get("title", "untitled"),
            file_id=record.get("fileId", rkey),
            file_type=record.get("fileType", "mp3"),
            artist_did=did,
            r2_url=audio_url if audio_storage == "r2" else None,
            atproto_record_uri=uri,
            atproto_record_cid=cid,
            audio_storage=audio_storage,
            pds_blob_cid=pds_blob_cid,
            description=record.get("description"),
            image_url=record.get("imageUrl"),
            created_at=_parse_datetime(record.get("createdAt")),
            extra=extra,
        )
        db.add(track)
        await db.commit()
        logfire.info(
            "ingest: track created",
            uri=uri,
            artist_did=did,
            audio_storage=audio_storage,
        )


async def ingest_track_update(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None,
) -> None:
    """update mutable fields on an existing track."""
    async with db_session() as db:
        result = await db.execute(
            select(Track).where(Track.atproto_record_uri == uri).limit(1)
        )
        track = result.scalar_one_or_none()
        if not track:
            logger.debug("ingest_track_update: track %s not found, skipping", uri)
            return

        if title := record.get("title"):
            track.title = title
        if description := record.get("description"):
            track.description = description
        if image_url := record.get("imageUrl"):
            track.image_url = image_url
        if cid:
            track.atproto_record_cid = cid

        await db.commit()
        logfire.info("ingest: track updated", uri=uri, artist_did=did)


async def ingest_track_delete(
    did: str,
    rkey: str,
    uri: str,
) -> None:
    """delete a track by its AT URI."""
    async with db_session() as db:
        result = await db.execute(delete(Track).where(Track.atproto_record_uri == uri))
        if result.rowcount:  # type: ignore[union-attr]
            await db.commit()
            logfire.info("ingest: track deleted", uri=uri, artist_did=did)
        else:
            logger.debug("ingest_track_delete: track %s not found", uri)


# --- like tasks ---


async def ingest_like_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
) -> None:
    """create a like from a Jetstream event."""
    subject = record.get("subject", {})
    subject_uri = subject.get("uri", "")

    async with db_session() as db:
        # resolve subject track
        result = await db.execute(
            select(Track.id).where(Track.atproto_record_uri == subject_uri).limit(1)
        )
        track_id = result.scalar_one_or_none()
        if track_id is None:
            logger.debug("ingest_like_create: subject track %s not found", subject_uri)
            return

        # dedup: unique constraint on (track_id, user_did)
        existing = await db.execute(
            select(TrackLike.id)
            .where(TrackLike.track_id == track_id, TrackLike.user_did == did)
            .limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            logger.debug(
                "ingest_like_create: duplicate like for track %d by %s", track_id, did
            )
            return

        like = TrackLike(
            track_id=track_id,
            user_did=did,
            atproto_like_uri=uri,
            created_at=_parse_datetime(record.get("createdAt")),
        )
        db.add(like)
        await db.commit()
        logfire.info("ingest: like created", uri=uri, user_did=did, track_id=track_id)


async def ingest_like_delete(
    did: str,
    rkey: str,
    uri: str,
) -> None:
    """delete a like by its AT URI."""
    async with db_session() as db:
        result = await db.execute(
            delete(TrackLike).where(TrackLike.atproto_like_uri == uri)
        )
        if result.rowcount:  # type: ignore[union-attr]
            await db.commit()
            logfire.info("ingest: like deleted", uri=uri)
        else:
            logger.debug("ingest_like_delete: like %s not found", uri)


# --- comment tasks ---


async def ingest_comment_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
) -> None:
    """create a comment from a Jetstream event."""
    subject = record.get("subject", {})
    subject_uri = subject.get("uri", "")

    async with db_session() as db:
        # resolve subject track
        result = await db.execute(
            select(Track.id).where(Track.atproto_record_uri == subject_uri).limit(1)
        )
        track_id = result.scalar_one_or_none()
        if track_id is None:
            logger.debug(
                "ingest_comment_create: subject track %s not found", subject_uri
            )
            return

        comment = TrackComment(
            track_id=track_id,
            user_did=did,
            text=record.get("text", ""),
            timestamp_ms=record.get("timestampMs", 0),
            atproto_comment_uri=uri,
            created_at=_parse_datetime(record.get("createdAt")),
        )
        db.add(comment)
        await db.commit()
        logfire.info(
            "ingest: comment created", uri=uri, user_did=did, track_id=track_id
        )


async def ingest_comment_update(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
) -> None:
    """update comment text and timestamp."""
    values: dict = {}
    if text := record.get("text"):
        values["text"] = text
    if (ts := record.get("timestampMs")) is not None:
        values["timestamp_ms"] = ts

    if not values:
        return

    values["updated_at"] = datetime.now(UTC)

    async with db_session() as db:
        result = await db.execute(
            update(TrackComment)
            .where(TrackComment.atproto_comment_uri == uri)
            .values(**values)
        )
        if result.rowcount:  # type: ignore[union-attr]
            await db.commit()
            logfire.info("ingest: comment updated", uri=uri)
        else:
            logger.debug("ingest_comment_update: comment %s not found", uri)


async def ingest_comment_delete(
    did: str,
    rkey: str,
    uri: str,
) -> None:
    """delete a comment by its AT URI."""
    async with db_session() as db:
        result = await db.execute(
            delete(TrackComment).where(TrackComment.atproto_comment_uri == uri)
        )
        if result.rowcount:  # type: ignore[union-attr]
            await db.commit()
            logfire.info("ingest: comment deleted", uri=uri)
        else:
            logger.debug("ingest_comment_delete: comment %s not found", uri)


# --- list (playlist) tasks ---


async def ingest_list_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
) -> None:
    """create a playlist from a Jetstream list event.

    only processes listType="playlist" — skips albums and liked lists.
    """
    list_type = record.get("listType", "")
    if list_type != "playlist":
        logger.debug("ingest_list_create: skipping listType=%s", list_type)
        return

    async with db_session() as db:
        # verify artist exists
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_list_create: unknown artist %s", did)
            return

        # dedup by AT URI
        existing = await db.execute(
            select(Playlist.id).where(Playlist.atproto_record_uri == uri).limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            logger.debug("ingest_list_create: duplicate URI %s", uri)
            return

        playlist = Playlist(
            owner_did=did,
            name=record.get("name", "untitled"),
            atproto_record_uri=uri,
            atproto_record_cid=cid or "",
            created_at=_parse_datetime(record.get("createdAt")),
        )
        db.add(playlist)
        await db.commit()
        logfire.info("ingest: playlist created", uri=uri, owner_did=did)


async def ingest_list_update(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
) -> None:
    """update playlist name."""
    async with db_session() as db:
        result = await db.execute(
            select(Playlist).where(Playlist.atproto_record_uri == uri).limit(1)
        )
        playlist = result.scalar_one_or_none()
        if not playlist:
            logger.debug("ingest_list_update: playlist %s not found", uri)
            return

        if name := record.get("name"):
            playlist.name = name
        if cid:
            playlist.atproto_record_cid = cid

        await db.commit()
        logfire.info("ingest: playlist updated", uri=uri)


async def ingest_list_delete(
    did: str,
    rkey: str,
    uri: str,
) -> None:
    """delete a playlist by its AT URI."""
    async with db_session() as db:
        result = await db.execute(
            delete(Playlist).where(Playlist.atproto_record_uri == uri)
        )
        if result.rowcount:  # type: ignore[union-attr]
            await db.commit()
            logfire.info("ingest: playlist deleted", uri=uri)
        else:
            logger.debug("ingest_list_delete: playlist %s not found", uri)


# --- profile task ---


async def ingest_profile_update(
    did: str,
    record: dict,
) -> None:
    """update artist bio from a profile record."""
    async with db_session() as db:
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_profile_update: unknown artist %s", did)
            return

        if (bio := record.get("bio")) is not None:
            artist.bio = bio
            await db.commit()
            logfire.info("ingest: profile updated", did=did)

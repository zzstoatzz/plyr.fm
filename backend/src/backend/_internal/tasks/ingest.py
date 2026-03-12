"""Jetstream event ingestion tasks.

each task resolves an ATProto record event into the database. they are
dispatched by the JetstreamConsumer via docket and run asynchronously.

all tasks are idempotent — duplicate events are safely skipped via
unique constraint checks or existence queries.
"""

import logging
from datetime import UTC, datetime, timedelta

import logfire
from docket import ConcurrencyLimit, ExponentialRetry
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from backend._internal.atproto.client import pds_blob_url
from backend._internal.tasks.hooks import run_post_track_create_hooks
from backend.models import Artist, Playlist, Track, TrackComment, TrackLike
from backend.utilities.database import db_session
from backend.utilities.lexicon import validate_record

logger = logging.getLogger(__name__)


class SubjectNotFoundError(Exception):
    """referenced subject (track) not yet indexed — triggers retry."""


_INGEST_RETRY = ExponentialRetry(
    attempts=4,
    minimum_delay=timedelta(seconds=1),
    maximum_delay=timedelta(seconds=30),
)


_MAX_CLOCK_SKEW = timedelta(minutes=5)


def _parse_datetime(value: str | None) -> datetime:
    """parse an ISO 8601 datetime string, falling back to now."""
    if not value:
        return datetime.now(UTC)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
    except (ValueError, AttributeError):
        return datetime.now(UTC)


def _is_future_timestamp(value: str | None) -> bool:
    """return True if the timestamp is beyond acceptable clock skew."""
    if not value:
        return False
    dt = _parse_datetime(value)
    return dt > datetime.now(UTC) + _MAX_CLOCK_SKEW


# --- track tasks ---


async def ingest_track_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None,
    retry: ExponentialRetry = _INGEST_RETRY,
    concurrency: ConcurrencyLimit = ConcurrencyLimit("did", max_concurrent=3),  # noqa: B008
) -> None:
    """create a track from a Jetstream event.

    args:
        did: the DID of the artist
        rkey: record key
        record: the ATProto record data
        uri: the AT URI (at://did/collection/rkey)
        cid: content identifier
    """
    if errors := validate_record("fm.plyr.track", record):
        logfire.warn("ingest: invalid track record, skipping", uri=uri, errors=errors)
        return

    if not record.get("audioUrl") and not record.get("audioBlob"):
        logfire.warn(
            "ingest: track has neither audioUrl nor audioBlob, skipping", uri=uri
        )
        return

    if _is_future_timestamp(record.get("createdAt")):
        logfire.warn("ingest: track createdAt is in the future, skipping", uri=uri)
        return

    async with db_session() as db:
        # verify artist exists
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_track_create: unknown artist %s, skipping", did)
            return

        # check for existing row by URI (may be pending from upload path)
        existing = await db.execute(
            select(Track).where(Track.atproto_record_uri == uri).limit(1)
        )
        existing_track = existing.scalar_one_or_none()

        if existing_track is not None:
            if existing_track.publish_state == "pending":
                # upload path reserved this row — finalize it
                existing_track.atproto_record_cid = cid
                existing_track.publish_state = "published"
                await db.commit()
                await db.refresh(existing_track)

                resolved_audio_url = existing_track.r2_url
                if (
                    not resolved_audio_url
                    and existing_track.pds_blob_cid
                    and artist.pds_url
                ):
                    resolved_audio_url = pds_blob_url(
                        artist.pds_url, did, existing_track.pds_blob_cid
                    )

                logfire.info(
                    "ingest: finalized pending track",
                    uri=uri,
                    artist_did=did,
                    track_id=existing_track.id,
                )

                await run_post_track_create_hooks(
                    existing_track.id, audio_url=resolved_audio_url
                )
            else:
                logger.debug("ingest_track_create: duplicate URI %s, skipping", uri)
            return

        # no existing row — create from scratch (external ATProto client)
        audio_blob = record.get("audioBlob")
        audio_url = record.get("audioUrl")
        pds_blob_cid = (
            audio_blob.get("ref", {}).get("$link")
            if isinstance(audio_blob, dict)
            else None
        )
        if audio_blob and audio_url:
            audio_storage = "both"
        elif audio_blob:
            audio_storage = "pds"
        elif audio_url:
            audio_storage = "r2"
            pds_blob_cid = None
        else:
            audio_storage = "pds"

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
            r2_url=audio_url if audio_storage in ("r2", "both") else None,
            atproto_record_uri=uri,
            atproto_record_cid=cid,
            audio_storage=audio_storage,
            pds_blob_cid=pds_blob_cid,
            publish_state="published",
            description=record.get("description"),
            image_url=record.get("imageUrl"),
            support_gate=record.get("supportGate"),
            features=record.get("features"),
            created_at=_parse_datetime(record.get("createdAt")),
            extra=extra,
        )
        db.add(track)
        try:
            await db.commit()
        except IntegrityError:
            logger.debug("ingest_track_create: duplicate URI %s (race), skipping", uri)
            return

        resolved_audio_url = track.r2_url
        if not resolved_audio_url and pds_blob_cid and artist.pds_url:
            resolved_audio_url = pds_blob_url(artist.pds_url, did, pds_blob_cid)

        logfire.info(
            "ingest: track created",
            uri=uri,
            artist_did=did,
            audio_storage=audio_storage,
        )

    await run_post_track_create_hooks(track.id, audio_url=resolved_audio_url)


async def ingest_track_update(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """update mutable fields on an existing track."""
    if errors := validate_record("fm.plyr.track", record, partial=True):
        logfire.warn("ingest: invalid track record, skipping", uri=uri, errors=errors)
        return

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

        # audio storage fields
        audio_blob = record.get("audioBlob")
        audio_url = record.get("audioUrl")
        if audio_blob and isinstance(audio_blob, dict) and audio_url:
            track.audio_storage = "both"
            track.pds_blob_cid = audio_blob.get("ref", {}).get("$link")
            track.r2_url = audio_url
        elif audio_blob and isinstance(audio_blob, dict):
            track.audio_storage = "pds"
            track.pds_blob_cid = audio_blob.get("ref", {}).get("$link")
            track.r2_url = None
        elif audio_url:
            track.audio_storage = "r2"
            track.r2_url = audio_url
            track.pds_blob_cid = None
        if file_type := record.get("fileType"):
            track.file_type = file_type

        # gating
        if "supportGate" in record:
            track.support_gate = record["supportGate"]

        # features
        if (features := record.get("features")) is not None:
            track.features = features

        # extra fields (album, duration) — reassign to trigger change detection
        extra = dict(track.extra or {})
        extra_changed = False
        if (duration := record.get("duration")) is not None:
            extra["duration"] = duration
            extra_changed = True
        if (album := record.get("album")) is not None:
            extra["album"] = album
            extra_changed = True
        if extra_changed:
            track.extra = extra

        await db.commit()
        logfire.info("ingest: track updated", uri=uri, artist_did=did)


async def ingest_track_delete(
    did: str,
    rkey: str,
    uri: str,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """delete a track by its AT URI."""
    try:
        async with db_session() as db:
            result = await db.execute(
                delete(Track).where(Track.atproto_record_uri == uri)
            )
            if result.rowcount:  # type: ignore[union-attr]
                await db.commit()
                logfire.info("ingest: track deleted", uri=uri, artist_did=did)
            else:
                logger.debug("ingest_track_delete: track %s not found", uri)
    except OperationalError:
        # deadlock with the API delete — the other transaction will handle it
        logger.debug("ingest_track_delete: deadlock on %s, skipping", uri)


# --- like tasks ---


async def ingest_like_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """create a like from a Jetstream event."""
    if errors := validate_record("fm.plyr.like", record):
        logfire.warn("ingest: invalid like record, skipping", uri=uri, errors=errors)
        return

    subject = record.get("subject", {})
    subject_uri = subject.get("uri", "")

    async with db_session() as db:
        # resolve subject track
        result = await db.execute(
            select(Track.id).where(Track.atproto_record_uri == subject_uri).limit(1)
        )
        track_id = result.scalar_one_or_none()
        if track_id is None:
            raise SubjectNotFoundError(
                f"ingest_like_create: subject track {subject_uri} not found"
            )

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
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """delete a like by its AT URI."""
    try:
        async with db_session() as db:
            result = await db.execute(
                delete(TrackLike).where(TrackLike.atproto_like_uri == uri)
            )
            if result.rowcount:  # type: ignore[union-attr]
                await db.commit()
                logfire.info("ingest: like deleted", uri=uri)
            else:
                logger.debug("ingest_like_delete: like %s not found", uri)
    except OperationalError:
        logger.debug("ingest_like_delete: deadlock on %s, skipping", uri)


# --- comment tasks ---


async def ingest_comment_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """create a comment from a Jetstream event."""
    if errors := validate_record("fm.plyr.comment", record):
        logfire.warn("ingest: invalid comment record, skipping", uri=uri, errors=errors)
        return

    subject = record.get("subject", {})
    subject_uri = subject.get("uri", "")

    async with db_session() as db:
        # resolve subject track
        result = await db.execute(
            select(Track.id).where(Track.atproto_record_uri == subject_uri).limit(1)
        )
        track_id = result.scalar_one_or_none()
        if track_id is None:
            raise SubjectNotFoundError(
                f"ingest_comment_create: subject track {subject_uri} not found"
            )

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
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """update comment text and timestamp."""
    if errors := validate_record("fm.plyr.comment", record, partial=True):
        logfire.warn("ingest: invalid comment record, skipping", uri=uri, errors=errors)
        return

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
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """delete a comment by its AT URI."""
    try:
        async with db_session() as db:
            result = await db.execute(
                delete(TrackComment).where(TrackComment.atproto_comment_uri == uri)
            )
            if result.rowcount:  # type: ignore[union-attr]
                await db.commit()
                logfire.info("ingest: comment deleted", uri=uri)
            else:
                logger.debug("ingest_comment_delete: comment %s not found", uri)
    except OperationalError:
        logger.debug("ingest_comment_delete: deadlock on %s, skipping", uri)


# --- list (playlist) tasks ---


async def ingest_list_create(
    did: str,
    rkey: str,
    record: dict,
    uri: str,
    cid: str | None = None,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """create a playlist from a Jetstream list event.

    only processes listType="playlist" — skips albums and liked lists.
    """
    if errors := validate_record("fm.plyr.list", record):
        logfire.warn("ingest: invalid list record, skipping", uri=uri, errors=errors)
        return

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
            track_count=len(record.get("items", [])),
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
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """update playlist metadata."""
    if errors := validate_record("fm.plyr.list", record, partial=True):
        logfire.warn("ingest: invalid list record, skipping", uri=uri, errors=errors)
        return

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
        if (items := record.get("items")) is not None:
            playlist.track_count = len(items)

        await db.commit()
        logfire.info("ingest: playlist updated", uri=uri)


async def ingest_list_delete(
    did: str,
    rkey: str,
    uri: str,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """delete a playlist by its AT URI."""
    try:
        async with db_session() as db:
            result = await db.execute(
                delete(Playlist).where(Playlist.atproto_record_uri == uri)
            )
            if result.rowcount:  # type: ignore[union-attr]
                await db.commit()
                logfire.info("ingest: playlist deleted", uri=uri)
            else:
                logger.debug("ingest_list_delete: playlist %s not found", uri)
    except OperationalError:
        logger.debug("ingest_list_delete: deadlock on %s, skipping", uri)


# --- profile task ---


async def ingest_profile_update(
    did: str,
    record: dict,
    retry: ExponentialRetry = _INGEST_RETRY,
) -> None:
    """update artist bio from a profile record."""
    if errors := validate_record("fm.plyr.actor.profile", record, partial=True):
        logfire.warn("ingest: invalid profile record, skipping", did=did, errors=errors)
        return

    async with db_session() as db:
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_profile_update: unknown artist %s", did)
            return

        if (bio := record.get("bio")) is not None:
            artist.bio = bio
            await db.commit()
            logfire.info("ingest: profile updated", did=did)

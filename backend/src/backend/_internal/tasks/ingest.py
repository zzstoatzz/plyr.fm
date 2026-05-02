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
from backend._internal.tasks.origin_trust import (
    is_trusted_audio_origin,
    is_trusted_image_origin,
)
from backend._internal.tasks.pds import is_like_uri_cancelled
from backend.config import settings
from backend.models import Artist, Playlist, Track, TrackComment, TrackLike
from backend.models.session import UserSession
from backend.utilities.database import db_session
from backend.utilities.lexicon import validate_record
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)


class SubjectNotFoundError(Exception):
    """referenced subject (track) not yet indexed — triggers retry."""


def _features_to_did_list(features: list | None) -> list[dict[str, str]]:
    """extract canonical DIDs from any historical feature shape.

    accepts:
    - new shape: `[{"did": "did:plc:..."}]`
    - legacy lexicon shape: `[{"did": "...", "handle": "...", "displayName": "..."}]`
    - already-flat: `["did:plc:...", "did:plc:..."]`

    returns the canonical DB shape: `[{"did": "did:plc:..."}]`. handle and
    displayName fields from the PDS record are intentionally discarded —
    they're stale snapshots that we resolve fresh at API-read time via
    `_internal.atproto.profiles.resolve_dids`.
    """
    if not features:
        return []
    out: list[dict[str, str]] = []
    for entry in features:
        if isinstance(entry, dict):
            did = entry.get("did")
            if isinstance(did, str) and did:
                out.append({"did": did})
        elif isinstance(entry, str) and entry.startswith("did:"):
            out.append({"did": entry})
    return out


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


_TOMBSTONE_PREFIX = "plyr:tombstone:"
_TOMBSTONE_TTL_SECONDS = 300  # 5 min — well beyond 5s cursor rewind

# NOTE: this suppresses ANY create for the same URI within the TTL window,
# not just stale replays. this is acceptable because plyr.fm always generates
# fresh TID-based rkeys for new tracks (upload path + restore-record), so a
# legitimate same-URI re-create never happens in practice. if ATProto same-URI
# putRecord support is ever needed, this will need a sequence check instead.


async def _write_tombstone(uri: str) -> None:
    """mark a URI as recently deleted so replayed creates are skipped."""
    try:
        redis = get_async_redis_client()
        await redis.set(f"{_TOMBSTONE_PREFIX}{uri}", "1", ex=_TOMBSTONE_TTL_SECONDS)
    except Exception:
        logger.debug("tombstone write failed for %s", uri)


async def _check_tombstone(uri: str) -> bool:
    """return True if the URI was recently deleted (fail-open on errors)."""
    try:
        redis = get_async_redis_client()
        return await redis.exists(f"{_TOMBSTONE_PREFIX}{uri}") > 0
    except Exception:
        logger.debug("tombstone check failed for %s", uri)
        return False


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

                is_staging = settings.observability.environment == "staging"
                await run_post_track_create_hooks(
                    existing_track.id,
                    audio_url=resolved_audio_url,
                    skip_notification=is_staging,
                    skip_copyright=is_staging,
                )
            else:
                logger.debug("ingest_track_create: duplicate URI %s, skipping", uri)
            return

        # recently deleted? skip to prevent ghost tracks from cursor rewind
        if await _check_tombstone(uri):
            logfire.info(
                "ingest: skipping create for tombstoned URI",
                uri=uri,
                artist_did=did,
            )
            return

        # no existing row — create from scratch (external ATProto client)
        audio_blob = record.get("audioBlob")
        audio_url = record.get("audioUrl")

        # validate audioUrl origin — untrusted URLs are stripped or rejected
        if audio_url and not await is_trusted_audio_origin(audio_url, artist_did=did):
            if audio_blob:
                logfire.warn(
                    "ingest: stripping untrusted audioUrl, using blob only",
                    uri=uri,
                    audio_url=audio_url,
                )
                audio_url = None
            else:
                logfire.warn(
                    "ingest: rejecting track with untrusted audioUrl and no blob",
                    uri=uri,
                    audio_url=audio_url,
                )
                return

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

        # validate imageUrl origin — untrusted URLs are stripped (track is still valid)
        image_url = record.get("imageUrl")
        if image_url and not await is_trusted_image_origin(image_url, artist_did=did):
            logfire.warn(
                "ingest: stripping untrusted imageUrl",
                uri=uri,
                image_url=image_url,
            )
            image_url = None

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
            image_url=image_url,
            support_gate=record.get("supportGate"),
            features=_features_to_did_list(record.get("features")),
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

    is_staging = settings.observability.environment == "staging"
    await run_post_track_create_hooks(
        track.id,
        audio_url=resolved_audio_url,
        skip_notification=is_staging,
        skip_copyright=is_staging,
    )


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
            if await is_trusted_image_origin(image_url, artist_did=did):
                track.image_url = image_url
            else:
                logfire.warn(
                    "ingest: stripping untrusted imageUrl on update",
                    uri=uri,
                    image_url=image_url,
                )
        if cid:
            track.atproto_record_cid = cid

        # audio storage fields
        audio_blob = record.get("audioBlob")
        audio_url = record.get("audioUrl")

        # strip untrusted audioUrl on update (don't reject the whole update)
        if audio_url and not await is_trusted_audio_origin(audio_url, artist_did=did):
            logfire.warn(
                "ingest: stripping untrusted audioUrl on update",
                uri=uri,
                audio_url=audio_url,
            )
            audio_url = None

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

        # features — store only the canonical DID. handle/displayName in the
        # PDS record are denormalized snapshots that drift; we resolve them
        # fresh at read time via _internal.atproto.profiles.
        if (features := record.get("features")) is not None:
            track.features = _features_to_did_list(features)

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
                logfire.warn(
                    "ingest: track not found for delete",
                    uri=uri,
                    artist_did=did,
                    rkey=rkey,
                )
    except OperationalError:
        logfire.warn("ingest: deadlock on track delete", uri=uri, artist_did=did)

    await _write_tombstone(uri)


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

    # `pds_create_like` tombstones URIs whose owning row was unliked while
    # the PDS create was still in flight. Jetstream may emit the create
    # event for that URI before our orphan-cleanup PDS delete propagates;
    # without this guard, we'd insert a row the user already cancelled
    # (the "like resurrects after unlike" race surfaced by
    # `test_cross_user_like` in integration tests).
    if await is_like_uri_cancelled(uri):
        logfire.info(
            "ingest: skipping cancelled like create event",
            uri=uri,
            user_did=did,
        )
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


# --- handle update task ---


async def ingest_identity_update(
    did: str,
    handle: str,
) -> None:
    """update artist handle, PDS URL, and avatar when an identity event arrives.

    identity events fire on handle changes, PDS migrations, and account
    reactivation. resolving the DID gives us the current PDS URL, and
    re-fetching the profile refreshes the avatar (which may have gone
    stale during account deactivation).
    """
    from atproto_identity.did.resolver import AsyncDidResolver

    from backend._internal.atproto.profile import fetch_user_avatar

    async with db_session() as db:
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_identity_update: unknown artist %s", did)
            return

        changes: dict[str, tuple[str | None, str | None]] = {}

        if artist.handle != handle:
            changes["handle"] = (artist.handle, handle)
            artist.handle = handle

            # update active sessions so session handles stay current
            await db.execute(
                update(UserSession).where(UserSession.did == did).values(handle=handle)
            )

        # resolve DID to get current PDS URL
        try:
            atproto_data = await AsyncDidResolver().resolve_atproto_data(did)
            resolved_pds = atproto_data.pds
            if resolved_pds and resolved_pds != artist.pds_url:
                changes["pds_url"] = (artist.pds_url, resolved_pds)
                artist.pds_url = resolved_pds
        except Exception as e:
            logger.warning(
                "ingest_identity_update: DID resolution failed for %s: %s", did, e
            )

        # refresh avatar from Bluesky profile
        try:
            fresh_avatar = await fetch_user_avatar(did)
            if fresh_avatar != artist.avatar_url:
                changes["avatar_url"] = (artist.avatar_url, fresh_avatar)
                artist.avatar_url = fresh_avatar
        except Exception as e:
            logger.warning(
                "ingest_identity_update: avatar fetch failed for %s: %s", did, e
            )

        if not changes:
            return

        await db.commit()
        logfire.info(
            "ingest: identity updated",
            did=did,
            changes={k: {"old": v[0], "new": v[1]} for k, v in changes.items()},
        )


async def ingest_account_status_change(
    did: str,
    active: bool,
) -> None:
    """handle account activation/deactivation events.

    on reactivation (active=True): re-fetch avatar from Bluesky since
    the CDN URL goes dead during deactivation.

    on deactivation (active=False): clear the avatar URL so the frontend
    doesn't show a broken image pointing at a dead CDN URL.
    """
    from backend._internal.atproto.profile import fetch_user_avatar

    async with db_session() as db:
        artist = await db.get(Artist, did)
        if not artist:
            logger.debug("ingest_account_status_change: unknown artist %s", did)
            return

        if active:
            # re-fetch avatar on reactivation
            try:
                fresh_avatar = await fetch_user_avatar(did)
                if fresh_avatar != artist.avatar_url:
                    artist.avatar_url = fresh_avatar
                    await db.commit()
                    logfire.info(
                        "ingest: avatar restored on reactivation",
                        did=did,
                        avatar_url=fresh_avatar,
                    )
            except Exception as e:
                logger.warning(
                    "ingest_account_status_change: avatar fetch failed for %s: %s",
                    did,
                    e,
                )
        else:
            # clear stale avatar on deactivation
            if artist.avatar_url:
                artist.avatar_url = None
                await db.commit()
                logfire.info("ingest: avatar cleared on deactivation", did=did)

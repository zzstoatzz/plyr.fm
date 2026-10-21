"""Reconcile legacy tags and publish opted-in genre tags."""

import logging
from datetime import UTC, datetime

from sqlalchemy import or_, select

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import parse_at_uri
from backend._internal.atproto.records.fm_plyr.track import (
    get_record_public_resilient,
    patch_track_record,
    read_track_record,
)
from backend._internal.auth import get_session
from backend.config import settings
from backend.models import Artist, Track, UserSession
from backend.utilities.database import db_session
from backend.utilities.tags import MAX_TAGS_PER_TRACK, normalize_tags
from backend.utilities.track_tags import indexed_tags, project_record_tags, record_tags

logger = logging.getLogger(__name__)


async def sync_track_tags(
    track_id: int, auth_session: AuthSession | None = None
) -> None:
    async with db_session() as db:
        track = await db.scalar(
            select(Track).where(Track.id == track_id).with_for_update()
        )
        if not track or not track.atproto_record_uri or track.is_private:
            return
        _, collection, _ = parse_at_uri(track.atproto_record_uri)
        if collection != settings.atproto.track_collection:
            return
        if auth_session and auth_session.did != track.artist_did:
            raise ValueError("tag sync session does not own track")
        if auth_session:
            snapshot = await read_track_record(auth_session, track.atproto_record_uri)
        else:
            pds_url = await db.scalar(
                select(Artist.pds_url).where(Artist.did == track.artist_did)
            )
            snapshot, _ = await get_record_public_resilient(
                track.atproto_record_uri, pds_url
            )
        tags = record_tags(snapshot["value"])
        extra = dict(track.extra or {})
        legacy = not extra.get("tags_pds_synced")
        local = await indexed_tags(db, track.id)
        needs_write = tags is None and legacy and bool(local)
        target = local if needs_write else (tags or [])
        predictions = extra.get("genre_predictions", [])
        auto_tag = (
            extra.get("auto_tag")
            and predictions
            and extra.get("genre_predictions_file_id") == track.file_id
        )
        if auto_tag and auth_session:
            top = float(predictions[0]["confidence"])
            suggested = [
                str(p["name"])
                for p in predictions
                if float(p["confidence"]) >= top * 0.5
            ][:5]
            target = list(dict.fromkeys([*target, *sorted(normalize_tags(suggested))]))[
                : max(MAX_TAGS_PER_TRACK, len(target))
            ]
            needs_write = True
        if needs_write:
            if not auth_session:
                return
            result = await patch_track_record(
                auth_session,
                track.atproto_record_uri,
                {"tags": target},
                snapshot=snapshot,
            )
            snapshot = result
            if rev := result.get("commit", {}).get("rev"):
                track.extra = {**(track.extra or {}), "tags_pds_rev": rev}
        await project_record_tags(db, track, snapshot["value"], authoritative=True)
        track.atproto_record_cid = snapshot["cid"]
        if auto_tag and auth_session:
            extra = dict(track.extra)
            extra.pop("auto_tag", None)
            track.extra = extra
        await db.commit()

    from backend._internal.tasks.hooks import invalidate_tracks_discovery_cache

    await invalidate_tracks_discovery_cache()


async def sync_user_track_tags(auth_session: AuthSession, user_did: str) -> None:
    if auth_session.did != user_did:
        raise ValueError("tag sync session does not own artist")
    async with db_session() as db:
        ids = list(
            await db.scalars(
                select(Track.id).where(
                    Track.artist_did == user_did,
                    Track.is_private.is_(False),
                    Track.atproto_record_uri.isnot(None),
                    or_(
                        Track.extra["tags_pds_synced"]
                        .as_boolean()
                        .is_distinct_from(True),
                        Track.extra["auto_tag"].as_boolean().is_(True),
                    ),
                )
            )
        )
    for track_id in ids:
        try:
            await sync_track_tags(track_id, auth_session)
        except Exception:
            logger.exception("track tag sync pending for track %s", track_id)


async def publish_auto_tags(track_id: int) -> None:
    async with db_session() as db:
        track = await db.get(Track, track_id)
        if not track or not (track.extra or {}).get("auto_tag"):
            return
        did = await db.scalar(select(Track.artist_did).where(Track.id == track_id))
        session_ids = list(
            await db.scalars(
                select(UserSession.session_id)
                .where(
                    UserSession.did == did,
                    or_(
                        UserSession.expires_at.is_(None),
                        UserSession.expires_at > datetime.now(UTC),
                    ),
                )
                .order_by(UserSession.created_at.desc())
                .limit(5)
            )
        )
    for session_id in session_ids:
        if auth_session := await get_session(session_id):
            try:
                await sync_track_tags(track_id, auth_session)
                return
            except Exception:
                logger.exception("automatic tags pending for track %s", track_id)
    logger.warning("automatic tags await an authorized session for track %s", track_id)

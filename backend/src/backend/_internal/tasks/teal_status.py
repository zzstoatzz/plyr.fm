"""keep a listener's fm.teal.actor.status in step with the player.

the player heartbeat (`POST /now-playing`, every ~10s, and `DELETE` on stop)
drives it: the status is set when a public track plays, re-set after a seek,
and ended early on pause or stop. otherwise it expires when the track would
end. apps like teal.fm and Colibri read this record to show "listening to".

the last state is kept in redis per listener, so heartbeats that change
nothing cost one redis read. the docket task writes whatever redis holds when
it runs, so tasks that land out of order still leave the newest state.
"""

import json
import logging
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta

import logfire
from atproto_oauth.scopes import ScopesSet
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend._internal.auth.session import Session
from backend._internal.background import get_docket
from backend.config import settings
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

# a seek moves the start by more than this before the status is re-set
RESTART_TOLERANCE_MS = 5_000
# a status lasts this long past the track's end
STATUS_GRACE = timedelta(seconds=30)
# and this long outright when the length is unknown (the lexicon default)
STATUS_TTL = timedelta(minutes=10)
STATE_TTL_S = 6 * 60 * 60
# a track this listener may not show is not re-checked for this long
SKIP_TTL_S = 120


@dataclass(frozen=True)
class StatusState:
    """what the listener's status shows (playing) or last showed (ended)."""

    track_id: int
    started_ms: int
    playing: bool
    ended_ms: int | None = None


def _state_key(did: str) -> str:
    return f"teal-status:{did}"


def _skip_key(did: str) -> str:
    return f"teal-status-skip:{did}"


def needs_write(want: tuple[int, int] | None, shown: StatusState | None) -> bool:
    """whether the status record is out of step with the player.

    args:
        want: (track_id, started_ms) while a track plays, else None
        shown: what the status record holds now
    """
    showing = shown is not None and shown.playing
    if want is None:
        return showing
    if not showing:
        return True
    assert shown is not None
    track_id, started_ms = want
    return (
        track_id != shown.track_id
        or abs(started_ms - shown.started_ms) > RESTART_TOLERANCE_MS
    )


def status_expiry(started_ms: int, duration_s: int | None, now: datetime) -> datetime:
    """when a status for a track that began at `started_ms` stops showing."""
    if duration_s and duration_s >= 1:
        started = datetime.fromtimestamp(started_ms / 1000, UTC)
        return max(now, started + timedelta(seconds=duration_s) + STATUS_GRACE)
    return now + STATUS_TTL


def _has_status_grant(session: Session) -> bool:
    scopes = ScopesSet.from_string((session.oauth_session or {}).get("scope", ""))
    collection = settings.teal.status_collection
    return scopes.matches(
        "repo", collection=collection, action="create"
    ) and scopes.matches("repo", collection=collection, action="update")


async def _may_show(session: Session, track_id: int) -> bool:
    """teal is on, the session holds the grant, and the track is public."""
    from backend.models import Track, UserPreferences
    from backend.utilities.database import db_session

    if not settings.teal.enabled or not _has_status_grant(session):
        return False
    async with db_session() as db:
        enabled = await db.scalar(
            select(UserPreferences.enable_teal_scrobbling).where(
                UserPreferences.did == session.did
            )
        )
        if not enabled:
            return False
        track = await db.get(Track, track_id)
        return bool(
            track
            and track.visibility == "public"
            and not track.support_gate
            and not track.space_uri
        )


async def sync_teal_status(
    session: Session,
    *,
    track_id: int | None,
    progress_ms: int = 0,
    is_playing: bool = False,
) -> None:
    """bring the listener's status in step with one player heartbeat.

    best-effort: failures are logged, never raised to the heartbeat.
    """
    try:
        now_ms = int(time.time() * 1000)
        want = (
            (track_id, now_ms - max(0, progress_ms))
            if is_playing and track_id is not None
            else None
        )
        redis = get_async_redis_client()
        key = _state_key(session.did)
        raw = await redis.get(key)
        shown = StatusState(**json.loads(raw)) if raw else None
        if not needs_write(want, shown):
            return

        if want is not None:
            skipped = await redis.get(_skip_key(session.did))
            if skipped is not None and int(skipped) == want[0]:
                may_show = False
            else:
                may_show = await _may_show(session, want[0])
                if not may_show:
                    await redis.set(_skip_key(session.did), str(want[0]), ex=SKIP_TTL_S)
            if not may_show:
                want = None
                if not needs_write(None, shown):
                    return

        if want is not None:
            state = StatusState(track_id=want[0], started_ms=want[1], playing=True)
        else:
            assert shown is not None
            state = StatusState(
                track_id=shown.track_id,
                started_ms=shown.started_ms,
                playing=False,
                ended_ms=now_ms,
            )
        await redis.set(key, json.dumps(asdict(state)), ex=STATE_TTL_S)
        await get_docket().add(write_teal_status)(session.session_id, session.did)
        logfire.info(
            "scheduled teal status",
            track_id=state.track_id,
            playing=state.playing,
        )
    except Exception:
        logger.warning("teal status sync failed", exc_info=True)


async def write_teal_status(session_id: str, did: str) -> None:
    """write the listener's newest status state to their PDS."""
    from backend._internal.atproto.teal import update_teal_status
    from backend._internal.auth import get_session
    from backend.models import Track
    from backend.utilities.database import db_session

    raw = await get_async_redis_client().get(_state_key(did))
    if not raw:
        return
    state = StatusState(**json.loads(raw))

    auth_session = await get_session(session_id)
    if not auth_session or auth_session.did != did:
        logger.warning(f"teal status: session {session_id[:8]}... not found")
        return

    async with db_session() as db:
        track = await db.scalar(
            select(Track)
            .options(selectinload(Track.artist), selectinload(Track.album_rel))
            .where(Track.id == state.track_id)
        )
    if not track:
        return

    now = datetime.now(UTC)
    expiry = (
        now
        if not state.playing
        else status_expiry(state.started_ms, track.duration, now)
    )
    try:
        uri = await update_teal_status(
            auth_session=auth_session,
            track_name=track.title,
            artist_name=track.artist.display_name or track.artist.handle,
            duration=track.duration,
            album_name=track.album_rel.title if track.album_rel else None,
            origin_url=f"{settings.frontend.url}/track/{track.id}",
            played_at=datetime.fromtimestamp(state.started_ms / 1000, UTC),
            expiry=expiry,
        )
        logger.info(f"teal status written: {uri} playing={state.playing}")
    except Exception as e:
        logger.error(f"teal status write failed for {did}: {e}", exc_info=True)

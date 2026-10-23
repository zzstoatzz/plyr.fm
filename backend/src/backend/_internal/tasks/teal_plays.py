"""backfill track_plays from the teal.fm scrobbles plyr wrote for its listeners.

`schedule_teal_play_backfill` runs hourly and enqueues one task per plyr
account not yet marked done in redis. each account task pages the account's
teal play records from its PDS, keeps plyr-origin plays of tracks that still
exist from before the first directly recorded play, and inserts them as
`source = 'teal'`. failures leave the account unmarked, so the next pass
retries it; inserts skip duplicates. once every account is done the scheduler
only checks the markers. see docs/internal/frontend/activity-chart.md.
"""

import logging
import re
from datetime import datetime, timedelta

import httpx
import logfire
from atproto_identity.did.resolver import AsyncDidResolver
from docket import Perpetual
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from backend._internal.background import get_docket
from backend.models import Artist, Track, TrackPlay
from backend.utilities.database import db_session
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

TEAL_PLAY_COLLECTIONS = ("fm.teal.alpha.feed.play", "fm.teal.feed.play")
DONE_KEY = "plyr:teal-play-backfill:v1:done:{did}"
_TRACK_URL = re.compile(r"^https://plyr\.fm/track/(\d+)")


def plyr_track_id(value: dict) -> int | None:
    """the plyr track id a teal play record points at, or None if it is not plyr's."""
    origin = value.get("originUri") or value.get("originUrl") or ""
    from_plyr = (
        value.get("musicServiceBaseDomain") == "plyr.fm"
        or value.get("musicServiceUri") == "https://plyr.fm"
        or (value.get("submissionClientAgent") or "").startswith("plyr.fm/")
    )
    if not from_plyr or not (match := _TRACK_URL.match(origin)):
        return None
    return int(match.group(1))


async def _pds_url(did: str, cached: str | None) -> str | None:
    if cached:
        return cached.rstrip("/")
    document = await AsyncDidResolver().resolve(did)
    endpoint = document.get_pds_endpoint() if document else None
    return endpoint.rstrip("/") if endpoint else None


async def _plyr_plays(pds: str, did: str) -> list[tuple[int, datetime]]:
    plays: list[tuple[int, datetime]] = []
    async with httpx.AsyncClient(timeout=30) as http:
        for collection in TEAL_PLAY_COLLECTIONS:
            cursor: str | None = None
            while True:
                params = {"repo": did, "collection": collection, "limit": 100}
                if cursor:
                    params["cursor"] = cursor
                response = await http.get(
                    f"{pds}/xrpc/com.atproto.repo.listRecords", params=params
                )
                response.raise_for_status()
                body = response.json()
                for record in body.get("records", []):
                    value = record.get("value", {})
                    if (track_id := plyr_track_id(value)) and (
                        played := value.get("playedTime")
                    ):
                        plays.append((track_id, datetime.fromisoformat(played)))
                if not body.get("records") or not (cursor := body.get("cursor")):
                    break
    return plays


async def backfill_teal_plays_for_account(did: str) -> None:
    """load one account's plyr-origin teal plays into track_plays."""
    async with db_session() as db:
        cached_pds = await db.scalar(select(Artist.pds_url).where(Artist.did == did))
    if not (pds := await _pds_url(did, cached_pds)):
        logger.warning("teal play backfill: no PDS for %s", did)
        return

    try:
        plays = await _plyr_plays(pds, did)
    except httpx.HTTPStatusError as exc:
        if not exc.response.is_client_error:
            raise
        logger.warning("teal play backfill: %s refused: %s", did, exc)
        plays = []
    inserted = 0
    async with db_session() as db:
        if plays:
            cutoff = await db.scalar(
                select(func.min(TrackPlay.played_at)).where(TrackPlay.source != "teal")
            )
            existing = set(
                (
                    await db.scalars(
                        select(Track.id).where(
                            Track.id.in_({track_id for track_id, _ in plays})
                        )
                    )
                ).all()
            )
            rows = [
                {"track_id": track_id, "played_at": played_at, "source": "teal"}
                for track_id, played_at in plays
                if track_id in existing and (cutoff is None or played_at < cutoff)
            ]
            if rows:
                result = await db.execute(
                    insert(TrackPlay)
                    .values(rows)
                    .on_conflict_do_nothing()
                    .returning(TrackPlay.id)
                )
                inserted = len(result.all())
                await db.commit()

    await get_async_redis_client().set(DONE_KEY.format(did=did), "1")
    logfire.info(
        "teal play backfill: account done",
        did=did,
        plyr_plays=len(plays),
        inserted=inserted,
    )


async def schedule_teal_play_backfill(
    perpetual: Perpetual = Perpetual(every=timedelta(hours=1), automatic=True),  # noqa: B008
) -> None:
    """enqueue the backfill for every plyr account not yet marked done."""
    async with db_session() as db:
        dids = (await db.scalars(select(Artist.did))).all()
    redis = get_async_redis_client()
    done = await redis.mget([DONE_KEY.format(did=did) for did in dids]) if dids else []
    pending = [did for did, marker in zip(dids, done, strict=True) if not marker]
    docket = get_docket()
    for did in pending:
        await docket.add(
            backfill_teal_plays_for_account, key=f"teal-play-backfill:{did}"
        )(did)
    if pending:
        logfire.info("teal play backfill: scheduled", accounts=len(pending))

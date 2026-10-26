"""teal.fm scrobble backfill into track_plays, with the PDS mocked at the HTTP edge."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks import teal_plays
from backend.models import Artist, Track, TrackPlay
from backend.utilities.redis import get_async_redis_client

DID = "did:plc:tealbackfill"
PDS = "https://pds.teal.test"
# conftest clears rows created after the test began, so nothing is backdated
FUTURE = datetime.now(UTC) + timedelta(days=30)


def _play(track_id: int, played_at: datetime, *, alpha: bool = False) -> dict:
    if alpha:
        value = {
            "musicServiceBaseDomain": "plyr.fm",
            "originUrl": f"https://plyr.fm/track/{track_id}",
        }
    else:
        value = {
            "musicServiceUri": "https://plyr.fm",
            "submissionClientAgent": "plyr.fm/1.0",
            "originUri": f"https://plyr.fm/track/{track_id}",
        }
    return {"value": {**value, "playedTime": played_at.isoformat()}}


def test_plyr_track_id_reads_both_record_shapes() -> None:
    now = FUTURE
    assert teal_plays.plyr_track_id(_play(12, now)["value"]) == 12
    assert teal_plays.plyr_track_id(_play(13, now, alpha=True)["value"]) == 13
    assert (
        teal_plays.plyr_track_id(
            {
                "musicServiceBaseDomain": "plyr.fm",
                "originUrl": "http://localhost:5173/track/1",
            }
        )
        is None
    )
    assert (
        teal_plays.plyr_track_id(
            {
                "musicServiceBaseDomain": "spotify.com",
                "originUrl": "https://open.spotify.com/track/x",
            }
        )
        is None
    )
    assert teal_plays.plyr_track_id({"originUri": "https://plyr.fm/track/9"}) is None


@pytest.fixture
def pds(
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[Callable[[httpx.Request], httpx.Response]], list[httpx.Request]]:
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    async def resolve(did: str) -> str:
        return PDS

    monkeypatch.setattr(teal_plays, "_pds_url", resolve)

    def install(
        handler: Callable[[httpx.Request], httpx.Response],
    ) -> list[httpx.Request]:
        def recording(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        monkeypatch.setattr(
            teal_plays.httpx,
            "AsyncClient",
            lambda **kwargs: real(transport=httpx.MockTransport(recording), **kwargs),
        )
        return seen

    return install


async def _account(db: AsyncSession) -> tuple[Track, int]:
    db.add(Artist(did=DID, handle="teal.test", display_name="teal", pds_url=PDS))
    track = Track(
        title="t", file_id="teal", file_type="mp3", artist_did=DID, created_at=FUTURE
    )
    db.add(track)
    await db.flush()
    await db.commit()
    return track, track.id + 1000


async def test_backfill_loads_plyr_plays_before_tracking_and_marks_done(
    db_session: AsyncSession, pds: Callable
) -> None:
    track, deleted_id = await _account(db_session)
    tracked_since = FUTURE + timedelta(days=5)
    db_session.add(TrackPlay(track_id=track.id, played_at=tracked_since, source="web"))
    await db_session.commit()
    records = {
        "fm.teal.alpha.feed.play": [
            _play(track.id, FUTURE + timedelta(days=1), alpha=True)
        ],
        "fm.teal.feed.play": [
            _play(track.id, FUTURE + timedelta(days=2)),
            _play(track.id, tracked_since + timedelta(hours=1)),
            _play(deleted_id, FUTURE + timedelta(days=3)),
            {
                "value": {
                    "musicServiceUri": "https://open.spotify.com",
                    "playedTime": FUTURE.isoformat(),
                }
            },
        ],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).startswith(f"{PDS}/xrpc/com.atproto.repo.listRecords")
        return httpx.Response(
            200, json={"records": records[request.url.params["collection"]]}
        )

    pds(handler)
    redis = get_async_redis_client()
    await redis.delete(teal_plays.DONE_KEY.format(did=DID))

    await teal_plays.backfill_teal_plays_for_account(DID)
    await teal_plays.backfill_teal_plays_for_account(DID)

    rows = (
        await db_session.scalars(
            select(TrackPlay.played_at)
            .where(TrackPlay.source == "teal")
            .order_by(TrackPlay.played_at)
        )
    ).all()
    assert rows == [FUTURE + timedelta(days=1), FUTURE + timedelta(days=2)]
    assert await redis.get(teal_plays.DONE_KEY.format(did=DID))
    await redis.delete(teal_plays.DONE_KEY.format(did=DID))


async def test_a_refused_collection_is_skipped_and_server_errors_retry(
    db_session: AsyncSession, pds: Callable
) -> None:
    track, _ = await _account(db_session)
    redis = get_async_redis_client()
    key = teal_plays.DONE_KEY.format(did=DID)
    await redis.delete(key)

    pds(lambda request: httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        await teal_plays.backfill_teal_plays_for_account(DID)
    assert not await redis.get(key)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params["collection"] == "fm.teal.alpha.feed.play":
            return httpx.Response(400, json={"error": "InvalidRequest"})
        return httpx.Response(
            200, json={"records": [_play(track.id, FUTURE + timedelta(days=1))]}
        )

    pds(handler)
    await teal_plays.backfill_teal_plays_for_account(DID)
    assert await redis.get(key)
    rows = (
        await db_session.scalars(
            select(TrackPlay.played_at).where(TrackPlay.source == "teal")
        )
    ).all()
    assert rows == [FUTURE + timedelta(days=1)]
    await redis.delete(key)


async def test_scheduler_enqueues_only_unfinished_accounts(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_session.add_all(
        [
            Artist(did="did:plc:tealdone", handle="done.test", display_name="d"),
            Artist(did="did:plc:tealtodo", handle="todo.test", display_name="t"),
        ]
    )
    await db_session.commit()
    redis = get_async_redis_client()
    await redis.set(teal_plays.DONE_KEY.format(did="did:plc:tealdone"), "1")
    await redis.delete(teal_plays.DONE_KEY.format(did="did:plc:tealtodo"))
    docket = MagicMock()
    enqueue = MagicMock(side_effect=lambda did: _done())
    docket.add.return_value = enqueue
    monkeypatch.setattr(teal_plays, "get_docket", lambda: docket)

    await teal_plays.schedule_teal_play_backfill()

    keys = [call.kwargs["key"] for call in docket.add.call_args_list]
    assert "teal-play-backfill:did:plc:tealtodo" in keys
    assert "teal-play-backfill:did:plc:tealdone" not in keys
    await redis.delete(teal_plays.DONE_KEY.format(did="did:plc:tealdone"))


async def _done() -> None:
    return None


async def test_an_unreachable_host_is_given_up_after_the_attempt_cap(
    db_session: AsyncSession, pds: Callable
) -> None:
    await _account(db_session)
    redis = get_async_redis_client()
    done = teal_plays.DONE_KEY.format(did=DID)
    attempts = teal_plays.ATTEMPTS_KEY.format(did=DID)
    await redis.delete(done)
    await redis.set(attempts, teal_plays.MAX_ATTEMPTS - 2)

    pds(lambda request: httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        await teal_plays.backfill_teal_plays_for_account(DID)
    assert not await redis.get(done)

    await teal_plays.backfill_teal_plays_for_account(DID)
    assert await redis.get(done)
    await redis.delete(done, attempts)

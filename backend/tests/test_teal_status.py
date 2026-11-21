"""tests for the teal.fm now-playing status kept from the player heartbeat."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal.atproto.teal import build_teal_status_record
from backend._internal.auth.session import Session
from backend._internal.tasks import teal_status
from backend._internal.tasks.teal_status import (
    STATUS_GRACE,
    STATUS_TTL,
    StatusState,
    needs_write,
    status_expiry,
    sync_teal_status,
)


class TestNeedsWrite:
    def test_nothing_playing_nothing_shown(self) -> None:
        assert not needs_write(None, None)

    def test_play_starts(self) -> None:
        assert needs_write((1, 1000), None)

    def test_same_track_same_start(self) -> None:
        shown = StatusState(track_id=1, started_ms=1000, playing=True)
        assert not needs_write((1, 4000), shown)

    def test_seek_moves_start(self) -> None:
        shown = StatusState(track_id=1, started_ms=1000, playing=True)
        assert needs_write((1, 60_000), shown)

    def test_new_track(self) -> None:
        shown = StatusState(track_id=1, started_ms=1000, playing=True)
        assert needs_write((2, 1000), shown)

    def test_pause_ends_shown(self) -> None:
        shown = StatusState(track_id=1, started_ms=1000, playing=True)
        assert needs_write(None, shown)

    def test_pause_after_end_is_quiet(self) -> None:
        shown = StatusState(track_id=1, started_ms=1000, playing=False, ended_ms=5)
        assert not needs_write(None, shown)

    def test_resume_after_end(self) -> None:
        shown = StatusState(track_id=1, started_ms=1000, playing=False, ended_ms=5)
        assert needs_write((1, 1000), shown)


class TestStatusExpiry:
    def test_expires_at_track_end_plus_grace(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)
        started_ms = int(now.timestamp() * 1000)
        assert status_expiry(started_ms, 2081, now) == (
            now + timedelta(seconds=2081) + STATUS_GRACE
        )

    def test_unknown_length_uses_lexicon_default(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)
        assert status_expiry(0, None, now) == now + STATUS_TTL

    def test_never_before_now(self) -> None:
        now = datetime(2026, 1, 1, tzinfo=UTC)
        assert status_expiry(0, 60, now) == now


class TestStatusRecord:
    def test_uses_given_start_and_expiry(self) -> None:
        now = datetime(2026, 1, 1, 12, tzinfo=UTC)
        record = build_teal_status_record(
            track_name="t",
            artist_name="a",
            played_at=now - timedelta(minutes=3),
            expiry=now + timedelta(minutes=2),
            now=now,
        )
        assert record["time"] == "2026-01-01T12:00:00Z"
        assert record["item"]["playedTime"] == "2026-01-01T11:57:00Z"
        assert record["expiry"] == "2026-01-01T12:02:00Z"

    def test_ended_status_expires_now(self) -> None:
        now = datetime(2026, 1, 1, 12, tzinfo=UTC)
        record = build_teal_status_record(
            track_name="t", artist_name="a", expiry=now, now=now
        )
        assert record["expiry"] == record["time"]


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.data[key] = value
        return True


@pytest.fixture
def harness():
    redis = FakeRedis()
    docket = MagicMock()
    docket.add.return_value = AsyncMock()
    may_show = AsyncMock(return_value=True)
    session = Session(
        session_id="sess", did="did:plc:listener", handle="l.test", oauth_session={}
    )
    with (
        patch.object(teal_status, "get_async_redis_client", return_value=redis),
        patch.object(teal_status, "get_docket", return_value=docket),
        patch.object(teal_status, "_may_show", may_show),
    ):
        yield redis, docket, may_show, session


def _state(redis: FakeRedis) -> StatusState:
    return StatusState(**json.loads(redis.data["teal-status:did:plc:listener"]))


class TestSyncTealStatus:
    async def test_heartbeats_write_once_then_end_on_pause(self, harness) -> None:
        redis, docket, _, session = harness
        clock = MagicMock()
        clock.time.side_effect = [1000.0, 1010.0, 1012.0, 1013.0]
        with patch.object(teal_status, "time", clock):
            await sync_teal_status(session, track_id=7, progress_ms=0, is_playing=True)
            await sync_teal_status(
                session, track_id=7, progress_ms=10_000, is_playing=True
            )
            await sync_teal_status(
                session, track_id=7, progress_ms=12_000, is_playing=False
            )
            await sync_teal_status(session, track_id=None)
        # play, then pause; the steady heartbeat and the stop write nothing
        assert docket.add.call_count == 2
        state = _state(redis)
        assert state.track_id == 7 and not state.playing
        assert state.started_ms == 1_000_000

    async def test_hidden_track_never_shows(self, harness) -> None:
        _, docket, may_show, session = harness
        may_show.return_value = False
        await sync_teal_status(session, track_id=7, is_playing=True)
        await sync_teal_status(session, track_id=7, progress_ms=10_000, is_playing=True)
        assert docket.add.call_count == 0
        assert may_show.await_count == 1

    async def test_switch_to_hidden_track_ends_status(self, harness) -> None:
        redis, docket, may_show, session = harness
        await sync_teal_status(session, track_id=7, is_playing=True)
        may_show.return_value = False
        await sync_teal_status(session, track_id=8, is_playing=True)
        assert docket.add.call_count == 2
        state = _state(redis)
        assert state.track_id == 7 and not state.playing

    async def test_failures_never_reach_the_heartbeat(self, harness) -> None:
        _, _, may_show, session = harness
        may_show.side_effect = RuntimeError("db down")
        await sync_teal_status(session, track_id=7, is_playing=True)

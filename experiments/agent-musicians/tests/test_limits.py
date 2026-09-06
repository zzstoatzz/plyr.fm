import random
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError
from studio.models import Note, select_peer
from studio.state import Store


def test_atomic_slot_survives_restart(tmp_path: Path) -> None:
    Store(tmp_path)
    now = datetime.now(UTC)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: Store(tmp_path).reserve(now), range(8)))
    assert sum(result is not None for result in results) == 1
    assert Store(tmp_path).reserve(now) is None


def test_request_cap_and_pilot_expiration(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now)
    assert session is not None
    for _ in range(12):
        store.call(session)
    with pytest.raises(RuntimeError):
        store.call(session)
    assert store.reserve(now + timedelta(days=8)) is None


def test_spend_stops_new_calls(tmp_path: Path) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC))
    assert session is not None
    store.charge(session, 0.051)
    with pytest.raises(RuntimeError):
        store.call(session)


def test_daily_release_reservation_includes_uncertain_upload(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_study("2026-09-06-1", "moss", {"upload_attempted": True})
    assert store.released_today("moss", "2026-09-06")
    assert not store.released_today("moss", "2026-09-07")


def test_score_cannot_overrun_clip() -> None:
    with pytest.raises(ValidationError):
        Note(pitch="C4", start=9, duration=2)
    with pytest.raises(ValidationError):
        Note(pitch="C99", start=0, duration=1)


def test_peer_distribution_excludes_self_and_keeps_exploration() -> None:
    roster = {
        name: {"profile": {"taste": {"density": density}, "curiosity": 0.5}}
        for name, density in [("a", 0.2), ("b", 0.2), ("c", 0.9)]
    }
    peer, probabilities = select_peer("a", roster, random.Random(1))
    assert peer != "a" and set(probabilities) == {"b", "c"}
    assert sum(probabilities.values()) == pytest.approx(1)
    assert all(p > 0 for p in probabilities.values())


def test_explicit_retry_keeps_the_original_budget(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now)
    assert session is not None
    store.call(session)
    store.charge(session, 0.01)
    store.finish(session, "failed")
    assert store.reserve(now) is None
    assert store.reserve(now, retry_failed=True) == session
    with store.connect() as db:
        assert db.execute("SELECT calls, spent, reserved FROM sessions").fetchone() == (
            1,
            0.01,
            0.05,
        )
    assert store.reserve(now, retry_failed=True) is None

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from studio.state import Store


def test_atomic_slot_survives_restart(tmp_path: Path) -> None:
    Store(tmp_path)
    now = datetime.now(UTC)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: Store(tmp_path).reserve(now), range(8)))
    assert sum(result is not None for result in results) == 1
    assert Store(tmp_path).reserve(now) is None


def test_request_cap_and_indefinite_schedule(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now)
    assert session is not None
    for _ in range(12):
        store.call(session)
    with pytest.raises(RuntimeError):
        store.call(session)
    assert Store(tmp_path).reserve(now + timedelta(days=80)) is not None


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


def test_monthly_cap_resumes_next_month_without_resetting_history(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path)
    start = datetime(2026, 9, 1, tzinfo=UTC)
    for slot in range(100):
        assert store.reserve(start + timedelta(hours=6 * slot)) is not None
    assert store.reserve(start + timedelta(hours=600)) is None
    assert Store(tmp_path).reserve(datetime(2026, 10, 1, tzinfo=UTC)) is not None
    assert store.usage(start)["month"]["budget_used"] == pytest.approx(5)


def test_actual_cost_and_failed_reservations_are_reported(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now)
    assert session is not None
    store.call(session)
    store.charge(session, 0.002)
    store.finish(session, "failed")
    usage = Store(tmp_path).usage(now)["month"]
    assert usage == {
        "sessions": 1,
        "calls": 1,
        "estimated_cost": 0.002,
        "budget_used": 0.05,
    }
    for invalid in (float("nan"), float("inf"), -1):
        with pytest.raises(ValueError):
            store.charge(session, invalid)


def test_rewriting_a_study_cannot_erase_upload_attempt(tmp_path: Path) -> None:
    store = Store(tmp_path)
    store.save_study(
        "2026-09-07-0", "moss", {"upload_attempted": True, "upload_id": "pending"}
    )
    store.save_study("2026-09-07-0", "moss", {"decision": {"title": "a revision"}})
    assert Store(tmp_path).released_today("moss", "2026-09-07")
    assert store.study("2026-09-07-0", "moss")["upload_id"] == "pending"


def test_bootstrap_is_once_and_charged_to_normal_budgets(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now, bootstrap=True)
    assert session is not None
    store.finish(session, "completed")
    assert store.reserve(now + timedelta(days=1), bootstrap=True) is None
    assert store.usage(now)["day"]["budget_used"] == 0.05
    with pytest.raises(RuntimeError):
        store.call(session)

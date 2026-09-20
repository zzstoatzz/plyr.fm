from datetime import UTC, datetime
from pathlib import Path

import pytest
from prefect.states import Failed

from studio.audio_errors import review_candidate
from studio.audio_model import retry_audio
from studio.state import BudgetExhausted, Store


@pytest.mark.parametrize("reason", ["MAX_TOKENS", "SAFETY", "OTHER"])
def test_incomplete_review_preserves_reason_and_usage(reason: str) -> None:
    body = {
        "candidates": [
            {"finishReason": reason, "content": {"parts": [{"text": "private"}]}}
        ],
        "usageMetadata": {"candidatesTokenCount": 100, "thoughtsTokenCount": 1500},
    }
    with pytest.raises(ValueError, match=reason) as error:
        review_candidate(body)
    assert "output_tokens=100" in str(error.value)
    assert "thinking_tokens=1500" in str(error.value)
    assert "private" not in str(error.value)


def test_blocked_review_has_no_candidate() -> None:
    with pytest.raises(ValueError, match="block_reason=SAFETY"):
        review_candidate({"promptFeedback": {"blockReason": "SAFETY"}})


def test_complete_review_keeps_content() -> None:
    candidate = {"finishReason": "STOP", "content": {"parts": [{"text": "{}"}]}}
    assert review_candidate({"candidates": [candidate]}) == candidate


def test_request_cap_preserves_reservation_and_distinguishes_budget(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now)
    for _ in range(12):
        store.call(session)
    with pytest.raises(BudgetExhausted, match="12/12 requests"):
        store.call(session)
    assert store.usage(now)["day"]["calls"] == 12
    assert store.usage(now)["day"]["budget_used"] == 0.10


def test_finished_session_is_not_a_budget_pause(tmp_path: Path) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC))
    store.finish(session, "completed")
    with pytest.raises(RuntimeError, match="not running") as error:
        store.call(session)
    assert not isinstance(error.value, BudgetExhausted)


def test_spend_cap_does_not_issue_another_request(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime.now(UTC)
    session = store.reserve(now)
    store.call(session)
    store.charge(session, 0.10)
    with pytest.raises(BudgetExhausted, match="1/12 requests"):
        store.call(session)
    assert store.usage(now)["day"]["calls"] == 1
    assert store.usage(now)["day"]["estimated_cost"] == 0.10


def test_truncation_retains_requested_limit_and_stops_at_recovery_limit() -> None:
    body = {
        "candidates": [{"finishReason": "MAX_TOKENS"}],
        "usageMetadata": {"candidatesTokenCount": 186, "thoughtsTokenCount": 613},
    }
    for limit, retry in [(1600, True), (4096, False)]:
        with pytest.raises(ValueError) as raised:
            review_candidate(body, output_limit=limit)
        assert f"requested_output_limit={limit}" in str(raised.value)
        assert retry_audio(None, None, Failed(data=raised.value)) is retry

from datetime import UTC, datetime
from pathlib import Path

import pytest

from studio.audio_errors import review_candidate
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

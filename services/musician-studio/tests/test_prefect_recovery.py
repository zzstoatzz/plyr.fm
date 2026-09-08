import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from prefect import flow
from prefect.settings import temporary_settings
from prefect.testing.utilities import prefect_test_harness

from studio import audio_model
from studio.audio_model import AudioProviderError, Feedback, retry_audio
from studio.state import Store


def test_original_run_keeps_reservation_across_slots(tmp_path: Path) -> None:
    store = Store(tmp_path)
    now = datetime(2026, 9, 8, 5, tzinfo=UTC)
    session = store.reserve(now, flow_run_id="original")
    store.call(session)
    store.finish(session, "failed")
    assert store.reserve(now + timedelta(hours=2), flow_run_id="original") == session
    assert store.usage(now)["day"]["sessions"] == 1
    assert store.usage(now)["day"]["calls"] == 1
    assert store.reserve(now + timedelta(days=1), flow_run_id="original") is None


@pytest.mark.parametrize(
    "error,expected",
    [
        (AudioProviderError(503), True),
        (AudioProviderError(429), True),
        (AudioProviderError(401), False),
        (ValueError("bad audio"), False),
        (RuntimeError("budget exceeded"), False),
    ],
)
def test_only_transient_failures_retry(error: Exception, expected: bool) -> None:
    state = SimpleNamespace(result=lambda **kwargs: error)
    assert retry_audio(None, None, state) == expected


def test_native_retry_and_audio_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC))
    attempts = []
    client = httpx.Client

    def handle(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        if len(attempts) == 1:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "modelVersion": "test-audio",
                "usageMetadata": {
                    "promptTokenCount": 500,
                    "candidatesTokenCount": 100,
                    "promptTokensDetails": [{"modality": "AUDIO", "tokenCount": 250}],
                },
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "observations": "The bass obscures the upper notes.",
                                            "changes": "Lower the bass by three decibels.",
                                            "ready": True,
                                        }
                                    )
                                }
                            ]
                        },
                    }
                ],
            },
        )

    monkeypatch.setattr(audio_model, "key", lambda: "fake")
    monkeypatch.setattr(
        audio_model,
        "httpx",
        SimpleNamespace(
            Client=lambda **kwargs: client(
                transport=httpx.MockTransport(handle), **kwargs
            ),
            TransportError=httpx.TransportError,
        ),
    )
    operation = audio_model.audio_request.with_options(
        retry_delay_seconds=0, result_storage=tmp_path / "results"
    )
    monkeypatch.setattr(audio_model, "audio_request", operation)
    stages = []

    @flow(
        name="plyr.fm-studio-recovery-check",
        flow_run_name="plyr.fm-studio-recovery-check",
        retries=1,
        retry_delay_seconds=0,
    )
    def pipeline(data: bytes, prompt: str) -> None:
        audio = tmp_path / "recording.wav"
        audio.write_bytes(data)
        audio_model.request_audio(store, session, audio, prompt, Feedback)
        stages.append(True)
        if len(stages) == 1:
            raise ValueError("later step failed")

    with (
        temporary_settings({"PREFECT_SERVER_ANALYTICS_ENABLED": False}),
        prefect_test_harness(),
    ):
        pipeline(b"audio one", "review")
        assert len(attempts) == 2
        pipeline(b"audio one", "review")
        assert len(attempts) == 2
        pipeline(b"audio two", "review")
        assert len(attempts) == 3
        pipeline(b"audio two", "new context")
        assert len(attempts) == 4
    assert store.usage(datetime.now(UTC))["day"]["calls"] == 4
    assert store.usage(datetime.now(UTC))["day"]["estimated_cost"] == pytest.approx(
        3 * 0.00165
    )

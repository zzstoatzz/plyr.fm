import base64
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from prefect.states import Failed
from pydantic import ValidationError

from studio import audio_model
from studio.audio_model import AudioProviderError, Feedback, retry_audio
from studio.listening import digest
from studio.state import Store


@pytest.mark.parametrize("audio_tokens", [250, 0])
def test_review_sends_audio_and_records_provider_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, audio_tokens: int
) -> None:
    store = Store(tmp_path)
    profile = json.loads((Path(__file__).parents[1] / "profiles/moss.json").read_text())
    store.save_musician("moss", profile)
    session = store.reserve(datetime.now(UTC))
    store.save_study(
        session, "moss", {"musical_plan": {"motif": "D F E D, answered in the bass"}}
    )
    audio = tmp_path / "recording.wav"
    audio.write_bytes(b"the exact rendered audio")
    inspirations = profile["profile"]["inspirations"]

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "fake"
        parts = json.loads(request.content)["contents"][0]["parts"]
        assert base64.b64decode(parts[1]["inline_data"]["data"]) == audio.read_bytes()
        assert parts[1]["inline_data"]["mime_type"] == "audio/wav"
        assert inspirations[0]["artist"] in parts[0]["text"]
        assert "D F E D, answered in the bass" not in parts[0]["text"]
        return httpx.Response(
            200,
            json={
                "modelVersion": "test-audio",
                "usageMetadata": {
                    "promptTokenCount": 500,
                    "candidatesTokenCount": 100,
                    "thoughtsTokenCount": 50,
                    "promptTokensDetails": [
                        {"modality": "AUDIO", "tokenCount": audio_tokens}
                    ],
                },
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "observations": "The upper tones mask the bass.",
                                            "changes": "Lower the upper tones by 3 dB.",
                                            "ready": False,
                                        }
                                    )
                                }
                            ]
                        },
                    }
                ],
            },
        )

    client = httpx.Client
    monkeypatch.setattr(audio_model, "key", lambda: "fake")
    monkeypatch.setattr(
        audio_model.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handle), **kwargs),
    )
    if audio_tokens:
        result = audio_model.listen(store, session, "moss", "moss", audio, inspirations)
        assert result.audio_sha256 == digest(audio)
        assert result.model == "test-audio"
        assert not result.ready
        assert len(store.listening_reviews(session, "moss")) == 1
    else:
        with pytest.raises(ValidationError):
            audio_model.listen(store, session, "moss", "moss", audio, inspirations)
        assert not store.listening_reviews(session, "moss")
    assert store.usage(datetime.now(UTC))["month"]["estimated_cost"] == pytest.approx(
        0.0021
    )


@pytest.mark.parametrize("period,expected_retry", [("Day", False), ("Minute", True)])
def test_quota_failure_retains_daily_limit_and_controls_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, period: str, expected_retry: bool
) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC))
    client = httpx.Client
    quota = f"GenerateRequestsPer{period}PerProjectPerModel-FreeTier"

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={
                "error": {
                    "message": "sensitive provider message must not be logged",
                    "details": [
                        {
                            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                            "violations": [{"quotaId": quota, "quotaValue": "20"}],
                        },
                        {
                            "@type": "type.googleapis.com/google.rpc.RetryInfo",
                            "retryDelay": "5s",
                        },
                    ],
                }
            },
        )

    monkeypatch.setattr(audio_model, "key", lambda: "fake")
    monkeypatch.setattr(
        audio_model.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handle), **kwargs),
    )
    with pytest.raises(AudioProviderError) as raised:
        audio_model.audio_request.fn(
            tmp_path, session, b"audio", "review", Feedback, "test"
        )
    error = raised.value
    assert f"{quota}=20" in str(error)
    assert "sensitive" not in str(error)
    assert error.daily_quota_exhausted is (not expected_retry)
    assert store.usage(datetime.now(UTC))["day"]["calls"] == 1
    assert store.usage(datetime.now(UTC))["day"]["estimated_cost"] == 0
    assert retry_audio(None, None, Failed(data=error)) is expected_retry


@pytest.mark.parametrize(
    "body", [None, [], {"error": []}, {"error": {"details": [None]}}]
)
def test_unstructured_provider_error_keeps_http_status(body: object) -> None:
    error = AudioProviderError.from_response(httpx.Response(503, json=body))
    assert error.status == 503
    assert not error.quotas

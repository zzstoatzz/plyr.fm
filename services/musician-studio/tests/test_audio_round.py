import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

import audio_round
from compose import Composition
from studio import audio_model
from studio.state import Store


def test_round_reviews_draft_and_revision_and_obtains_peer_feedback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store(tmp_path)
    for name in ("moss", "reed"):
        store.save_musician(
            name,
            json.loads(
                (Path(__file__).parents[1] / f"profiles/{name}.json").read_text()
            ),
        )
    session = store.reserve(datetime.now(UTC))
    store.save_study(
        session,
        "moss",
        {"python": "original", "title": "draft", "idea": "draft", "rendered": True},
    )
    draft = tmp_path / "draft.wav"
    draft.write_bytes(b"original recording")
    heard = []

    def handle(request: httpx.Request) -> httpx.Response:
        parts = json.loads(request.content)["contents"][0]["parts"]
        heard.append(parts)
        assert (
            store.musicians()["moss"]["profile"]["inspirations"][0]["artist"]
            in parts[0]["text"]
        )
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

    def compose(*args: object, **kwargs: object) -> Composition:
        assert "Lower the bass" in kwargs["revision"]
        return Composition(title="revision", idea="balance", python="revised")

    def render(code: str, directory: Path) -> dict:
        assert code == "revised"
        directory.mkdir(parents=True)
        (directory / "track.wav").write_bytes(b"revised recording")
        return {"duration": 10}

    client = httpx.Client
    monkeypatch.setattr(audio_model, "key", lambda: "fake")
    monkeypatch.setattr(
        audio_model.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handle), **kwargs),
    )
    monkeypatch.setattr(audio_round, "compose", compose)
    monkeypatch.setattr(audio_round, "render", render)
    final = audio_round.prepare_release(tmp_path, session, "moss", draft)
    assert final.read_bytes() == b"revised recording"
    assert len(heard) == 3
    assert heard[0][1] != heard[1][1]
    assert heard[1][1] == heard[2][1]
    assert len(store.listening_reviews(session, "moss")) == 3
    assert len(store.study(session, "moss")["audio_feedback"]) == 2
    assert audio_round.prepare_release(tmp_path, session, "moss", draft) == final
    assert len(heard) == 5
    assert len(store.listening_reviews(session, "moss")) == 3

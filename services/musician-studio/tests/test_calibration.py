import hashlib
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

import calibration
from studio.audio_model import AudioReceipt
from studio.state import Store


@pytest.mark.parametrize(
    ("kind", "active_seconds"),
    [
        ("silence", []),
        ("regular_noise_pulses", list(range(1, 9))),
        ("separated_notes", [1, 3, 5, 7]),
        ("stacked_notes", [1]),
    ],
)
def test_controls_have_known_event_timing(
    kind: calibration.ControlKind, active_seconds: list[int]
) -> None:
    audio = calibration.control_audio(kind, 0)
    assert audio.shape == (441000, 2)
    blocks = audio.reshape(10, 44100, 2)
    observed = np.flatnonzero(np.max(np.abs(blocks), axis=(1, 2)) > 0.001)
    assert observed.tolist() == active_seconds


def test_calibration_saves_wrong_answers_and_reuses_receipts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC), evaluation=True)
    calls = []

    def answer(
        store: Store, session: str, path: Path, prompt: str, schema: type
    ) -> tuple[calibration.HeardControl, AudioReceipt]:
        store.call(session)
        store.charge(session, 0.001)
        calls.append(path)
        assert path.stem.isdigit()
        assert "expected" not in prompt
        return calibration.HeardControl(
            kind="silence", confidence=1, description="No sound heard"
        ), AudioReceipt(
            model="test",
            audio_tokens=250,
            audio_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        )

    monkeypatch.setattr(calibration, "request_audio", answer)
    monkeypatch.setattr(calibration, "create_markdown_artifact", lambda **_kwargs: None)
    first = calibration.calibrate_listener.fn(tmp_path, session)
    second = calibration.calibrate_listener.fn(tmp_path, session)
    assert first == second
    assert first["correct"] == 2
    assert first["total"] == 6
    assert len(calls) == 6
    assert store.usage(datetime.now(UTC))["month"]["estimated_cost"] == pytest.approx(
        0.006
    )

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


def test_arrangements_change_only_the_intended_events() -> None:
    sr = 44100
    absent = calibration.arrangement_audio("absent", False)
    opening = calibration.arrangement_audio("opening", False)
    delayed = calibration.arrangement_audio("delayed", False)
    changed = calibration.arrangement_audio("opening", True)
    assert np.array_equal(delayed[: 3 * sr], absent[: 3 * sr])
    assert np.array_equal(delayed[3 * sr :], opening[3 * sr :])
    assert np.sqrt(np.mean((opening[:sr] - absent[:sr]) ** 2)) > 0.03
    assert np.array_equal(changed[: int(6.5 * sr)], opening[: int(6.5 * sr)])
    assert np.array_equal(changed[7 * sr :], opening[7 * sr :])
    for audio, frequency in [(opening, 784), (changed, 1047)]:
        section = audio[int(6.55 * sr) : int(6.8 * sr)].mean(axis=1)
        spectrum = np.abs(np.fft.rfft(section * np.hanning(len(section))))
        frequencies = np.fft.rfftfreq(len(section), 1 / sr)
        spectrum[frequencies < 600] = 0
        assert frequencies[np.argmax(spectrum)] == pytest.approx(frequency, abs=8)
    assert max(np.max(np.abs(x)) for x in [absent, opening, delayed, changed]) < 0.99


def test_arrangement_scores_bass_and_melody_separately(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC), evaluation=True)
    calls = []

    def answer(
        store: Store, session: str, path: Path, prompt: str, schema: type
    ) -> tuple[calibration.HeardArrangement, AudioReceipt]:
        store.call(session)
        calls.append((prompt, path.name))
        return calibration.HeardArrangement(
            bass_entry="absent",
            motif_change="same",
            confidence=1,
            description="A repeated melody with no low bass heard.",
        ), AudioReceipt(
            model="test",
            audio_tokens=250,
            audio_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        )

    monkeypatch.setattr(calibration, "request_audio", answer)
    monkeypatch.setattr(calibration, "create_markdown_artifact", lambda **_kwargs: None)
    result = calibration.calibrate_listener.fn(tmp_path, session, "arrangement")
    assert result["correct"] == 1
    assert sum(r["field_correct"]["bass_entry"] for r in result["results"]) == 2
    assert sum(r["field_correct"]["motif_change"] for r in result["results"]) == 3
    assert len({prompt for prompt, _ in calls}) == 1
    assert all(name[:-4].isdigit() for _, name in calls)
    assert calibration.calibrate_listener.fn(tmp_path, session, "arrangement") == result
    assert len(calls) == 6
    with pytest.raises(ValueError, match="Cannot change"):
        calibration.calibrate_listener.fn(tmp_path, session, "basic")


def test_suite_is_preserved_when_first_request_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: object) -> None:
        raise RuntimeError("Provider unavailable")

    monkeypatch.setattr(calibration, "request_audio", fail)
    with pytest.raises(RuntimeError):
        calibration.calibrate_listener.fn(tmp_path, "session", "arrangement")
    with pytest.raises(ValueError, match="Cannot change"):
        calibration.calibrate_listener.fn(tmp_path, "session", "basic")

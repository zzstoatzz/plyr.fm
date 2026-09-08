import wave
from pathlib import Path
from typing import Literal

import numpy as np
import pytest

from studio_instruments import (
    SAMPLE_RATE,
    beat_seconds,
    drum_hit,
    mix_voice,
    pitched_note,
    write_track,
)


@pytest.mark.parametrize("voice", ["pluck", "bass", "pad"])
def test_pitched_voices_preserve_audible_fundamental(
    voice: Literal["pluck", "bass", "pad"],
) -> None:
    audio = pitched_note(69, 1, voice)
    spectrum = np.abs(np.fft.rfft(audio))
    assert np.argmax(spectrum) == 440
    assert np.isfinite(audio).all()
    assert audio[0] == 0
    assert abs(audio[-1]) < 0.001


def test_arrangement_preserves_timing_pan_and_output(tmp_path: Path) -> None:
    mix = np.zeros((10 * SAMPLE_RATE, 2))
    start = beat_seconds(2, 120)
    mix_voice(mix, drum_hit("kick"), start, gain=0.3, pan=-1)
    assert np.max(np.abs(mix[:SAMPLE_RATE])) == 0
    assert np.max(np.abs(mix[SAMPLE_RATE:, 0])) > 0.1
    assert np.max(np.abs(mix[:, 1])) == 0
    path = tmp_path / "track.wav"
    write_track(mix * 20, str(path))
    with wave.open(str(path)) as wav:
        assert (wav.getnframes(), wav.getnchannels(), wav.getsampwidth()) == (
            441000,
            2,
            2,
        )
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        assert np.max(np.abs(audio)) < 30000


def test_silent_tail_and_invalid_output_are_not_hidden(tmp_path: Path) -> None:
    audio = np.zeros((10 * SAMPLE_RATE, 2))
    audio[0, 0] = np.nan
    with pytest.raises(ValueError):
        write_track(audio, str(tmp_path / "bad.wav"))

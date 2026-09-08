"""Optional instruments and timing tools; musical choices belong to the composer."""

import wave
from pathlib import Path
from typing import Literal

import numpy as np
from numpy.typing import NDArray

SAMPLE_RATE = 44100
Audio = NDArray[np.float64]


def note_hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12)


def beat_seconds(beat: float, bpm: float) -> float:
    if bpm <= 0:
        raise ValueError("Tempo must be positive")
    return beat * 60 / bpm


def pitched_note(
    midi: float,
    seconds: float,
    voice: Literal["pluck", "bass", "pad"] = "pluck",
) -> Audio:
    """Return a mono note; duration includes release. MIDI may be fractional."""
    if seconds <= 0 or voice not in {"pluck", "bass", "pad"}:
        raise ValueError("Expected positive duration and pluck, bass, or pad")
    t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    frequency = note_hz(midi)
    if not 0 < frequency < SAMPLE_RATE / 2:
        raise ValueError("Pitch outside the audible synthesis range")
    signal = np.zeros_like(t)
    for harmonic in range(1, 13):
        if frequency * harmonic >= SAMPLE_RATE / 2:
            break
        decay = np.exp(-t * harmonic / max(seconds * 0.5, 0.05))
        if voice == "pad":
            decay = np.ones_like(t)
        weight = harmonic ** (-2 if voice == "bass" else -1.5)
        signal += weight * decay * np.sin(2 * np.pi * frequency * harmonic * t)
    attack = min(seconds / 4, 0.15 if voice == "pad" else 0.005)
    release = min(seconds / 3, 0.25 if voice == "pad" else 0.04)
    envelope = np.minimum(1, t / attack) * np.minimum(1, (seconds - t) / release)
    signal *= envelope
    return signal / max(float(np.max(np.abs(signal), initial=0)), 1)


def drum_hit(voice: Literal["kick", "snare", "hat"], seed: int = 0) -> Audio:
    if voice not in {"kick", "snare", "hat"}:
        raise ValueError("Expected kick, snare, or hat")
    t = np.arange(round(0.3 * SAMPLE_RATE)) / SAMPLE_RATE
    noise = np.random.default_rng(seed).normal(0, 0.3, len(t))
    if voice == "kick":
        phase = 2 * np.pi * (48 * t + 85 * 0.025 * (1 - np.exp(-t / 0.025)))
        signal = np.sin(phase) * np.exp(-t / 0.065)
    elif voice == "snare":
        signal = (noise + 0.35 * np.sin(2 * np.pi * 185 * t)) * np.exp(-t / 0.045)
    else:
        signal = np.diff(noise, prepend=0) * np.exp(-t / 0.025)
    signal *= np.minimum(1, t / 0.001) * np.minimum(1, (0.3 - t) / 0.015)
    return signal / max(float(np.max(np.abs(signal))), 1)


def mix_voice(
    stereo: Audio, mono: Audio, start: float, gain: float = 0.2, pan: float = 0
) -> None:
    """Add a mono signal at a time in seconds, with equal-power pan (-1 to 1)."""
    if stereo.ndim != 2 or stereo.shape[1] != 2 or mono.ndim != 1:
        raise ValueError("Expected stereo destination and mono voice")
    if start < 0 or not -1 <= pan <= 1:
        raise ValueError("Expected nonnegative start and pan between -1 and 1")
    offset = round(start * SAMPLE_RATE)
    length = min(len(mono), len(stereo) - offset)
    if length <= 0:
        return
    angle = (pan + 1) * np.pi / 4
    stereo[offset : offset + length] += (
        mono[:length, None] * gain * np.array([np.cos(angle), np.sin(angle)])
    )


def write_track(stereo: Audio, path: str = "/output/track.wav") -> None:
    if stereo.shape != (10 * SAMPLE_RATE, 2) or not np.isfinite(stereo).all():
        raise ValueError("Expected ten seconds of finite stereo audio")
    audio = stereo.copy()
    fade = round(0.01 * SAMPLE_RATE)
    audio[:fade] *= np.linspace(0, 1, fade)[:, None]
    audio[-fade:] *= np.linspace(1, 0, fade)[:, None]
    audio *= min(1, 0.9 / max(float(np.max(np.abs(audio))), 1e-12))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(path, "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes((audio * 32767).astype("<i2").tobytes())

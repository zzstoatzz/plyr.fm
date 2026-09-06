"""Render validated scores with the original CC0 concert harp samples."""

import hashlib
import json
import math
import os
import subprocess
import wave
from pathlib import Path

import httpx
import imageio_ffmpeg
import numpy as np
from dac import Sample, note_to_freq
from dac.track import RenderConfig, mix

from studio.models import Score

ROOT = Path(__file__).resolve().parents[1]


def render(score: Score, directory: Path, name: str) -> Path:
    binary_dir = directory / "bin"
    binary_dir.mkdir(exist_ok=True)
    executable = binary_dir / "ffmpeg"
    if executable.is_symlink():
        executable.unlink()
    executable.symlink_to(imageio_ffmpeg.get_ffmpeg_exe())
    os.environ["PATH"] = str(binary_dir) + os.pathsep + os.environ["PATH"]
    source_info = json.loads((ROOT / "taste-results" / "harp.json").read_text())[
        "sources"
    ]
    for anchor, source in zip(("D4", "C5"), source_info, strict=True):
        path = directory / f"harp_{anchor}.wav"
        if path.exists():
            continue
        with httpx.Client(timeout=60) as client:
            response = client.get(source["url"])
            response.raise_for_status()
        if hashlib.sha256(response.content).hexdigest() != source["sha256"]:
            raise ValueError("Sample checksum mismatch")
        original = directory / f"source_{anchor}.wav"
        original.write_bytes(response.content)
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(original),
                "-ar",
                "48000",
                "-y",
                str(path),
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
    tracks = []
    for i, note in enumerate(score.events):
        anchor = "C5" if note_to_freq(note.pitch) >= note_to_freq("A4") else "D4"
        shift = 12 * math.log2(note_to_freq(note.pitch) / note_to_freq(anchor))
        track = Sample(directory / f"harp_{anchor}.wav", label=f"h{i}")
        track.pitch(shift).trim(note.duration).lowpass(score.lowpass)
        track.fade_in(min(score.attack, note.duration / 3))
        release = min(score.release, note.duration / 2)
        track.fade_out(release, start=note.duration - release).delay(
            round(note.start * 1000)
        ).pad(10).volume(0.12)
        tracks.append(track)
    output = directory / f"{name}.wav"
    mix(
        tracks,
        output,
        config=RenderConfig(duration=10, sample_rate=24000, limit_db=None),
    )
    with wave.open(str(output), "rb") as reader:
        samples = (
            np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2").astype(
                float
            )
            / 32768
        )
    rms = np.sqrt(np.mean(samples * samples))
    if rms <= 0 or not np.isfinite(samples).all():
        raise ValueError("Silent or invalid audio")
    samples *= min(10 ** (-22 / 20) / rms, 0.89 / max(abs(samples)))
    with wave.open(str(output), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(24000)
        writer.writeframes((samples * 32767).astype("<i2").tobytes())
    return output

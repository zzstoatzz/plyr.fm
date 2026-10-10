#!/usr/bin/env python3
"""Generate podcast audio on this machine with Kokoro: no key, no network after the model files.

The fallback for scripts/generate_tts.py when Gemini refuses. Same script format
("Host: ..." / "Cohost: ..."), same output (a WAV file).
"""
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["kokoro-onnx==0.6.1", "numpy"]
# ///

import argparse
import hashlib
import re
import urllib.request
import wave
from pathlib import Path

MODEL = "kokoro-82m"
RELEASE = (
    "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
)
# pinned: these are downloaded at run time and fed to an inference runtime
FILES = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
VOICES = {"Host": "af_kore", "Cohost": "am_puck"}
SPEAKER_LINE = re.compile(r"^(Host|Cohost):\s*(.*)$")
GAP_SECONDS = 0.35


def parse_turns(script: str) -> list[tuple[str, str]]:
    turns: list[tuple[str, list[str]]] = []
    for line_number, line in enumerate(script.splitlines(), start=1):
        match = SPEAKER_LINE.match(line)
        if match:
            speaker, text = match.groups()
            turns.append((speaker, [text]))
        elif turns:
            turns[-1][1].append(line)
        elif line.strip():
            raise ValueError(f"line {line_number} must start with Host: or Cohost:")
    if not turns:
        raise ValueError("script must contain at least one Host: or Cohost: turn")

    spoken: list[tuple[str, str]] = []
    for speaker, lines in turns:
        text = " ".join(part.strip() for part in lines if part.strip())
        if not text:
            raise ValueError(f"{speaker} turn must not be empty")
        spoken.append((speaker, text))
    return spoken


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_model(directory: Path) -> dict[str, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for name, expected in FILES.items():
        path = directory / name
        if not path.exists():
            print(f"downloading {name}")
            partial = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(f"{RELEASE}/{name}", partial)  # noqa: S310
            partial.rename(path)
        actual = sha256(path)
        if actual != expected:
            path.unlink()
            raise RuntimeError(f"{name} has sha256 {actual}, expected {expected}")
        paths[name] = path
    return paths


def to_pcm16(samples) -> bytes:  # noqa: ANN001
    import numpy as np

    return (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-dir", type=Path, default=Path.home() / ".cache" / "kokoro"
    )
    parser.add_argument("script_file", type=Path)
    parser.add_argument("output_file", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.script_file.exists():
        raise SystemExit(f"error: {args.script_file} not found")
    turns = parse_turns(args.script_file.read_text())
    print(
        f"generating audio from {args.script_file} ({len(turns)} turns, model {MODEL})"
    )

    from kokoro_onnx import Kokoro

    paths = fetch_model(args.model_dir)
    kokoro = Kokoro(str(paths["kokoro-v1.0.onnx"]), str(paths["voices-v1.0.bin"]))

    rate = 0
    frames = bytearray()
    for speaker, text in turns:
        samples, turn_rate = kokoro.create(
            text, voice=VOICES[speaker], speed=1.0, lang="en-us"
        )
        if rate and turn_rate != rate:
            raise RuntimeError(f"sample rate changed from {rate} to {turn_rate}")
        rate = turn_rate
        frames += to_pcm16(samples)
        frames += b"\x00\x00" * int(rate * GAP_SECONDS)

    with wave.open(str(args.output_file), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(bytes(frames))
    seconds = len(frames) / 2 / rate
    print(
        f"saved audio to {args.output_file} ({seconds:.0f}s, {len(frames) + 44} bytes)"
    )


if __name__ == "__main__":
    main()

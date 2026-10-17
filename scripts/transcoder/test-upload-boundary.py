# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.28"]
# ///
"""Exercise the advertised upload boundary with real padded FLAC and ffmpeg."""

import argparse
import json
import os
import random
import subprocess
import tempfile
from pathlib import Path

import httpx


MAX_FILE_BYTES = json.loads(
    (
        Path(__file__).resolve().parents[2] / "backend/src/backend/upload_contract.json"
    ).read_text()
)["max_file_bytes"]


def padded_flac(source: bytes, destination: Path, size: int) -> None:
    metadata = bytearray(source[:4])
    offset = 4
    while True:
        header = bytearray(source[offset : offset + 4])
        last = bool(header[0] & 128)
        header[0] &= 127
        length = int.from_bytes(header[1:], "big")
        metadata.extend(header)
        metadata.extend(source[offset + 4 : offset + 4 + length])
        offset += 4 + length
        if last:
            break
    frames = source[offset:]
    padding = size - len(metadata) - len(frames)
    with destination.open("wb") as output:
        output.write(metadata)
        while padding:
            block_size = min(padding, 0xFFFFFF + 4)
            if 0 < padding - block_size < 4:
                block_size -= 4
            padding -= block_size
            output.write(bytes([129 if padding == 0 else 1]))
            output.write((block_size - 4).to_bytes(3, "big"))
            output.seek(block_size - 4, 1)
        output.write(frames)
    assert destination.stat().st_size == size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8082")
    parser.add_argument("--max-file-bytes", type=int, default=MAX_FILE_BYTES)
    parser.add_argument("--generate", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source.flac"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency={random.uniform(220, 880)}:duration=0.1",
                str(source),
            ],
            check=True,
        )
        if args.generate:
            padded_flac(source.read_bytes(), args.generate, args.max_file_bytes)
            return
        headers = (
            {"X-Transcoder-Key": os.environ["TRANSCODER_AUTH_TOKEN"]}
            if os.environ.get("TRANSCODER_AUTH_TOKEN")
            else {}
        )
        with httpx.Client(timeout=300, headers=headers) as client:
            for size in sorted(
                {
                    min(1132800985, args.max_file_bytes),
                    args.max_file_bytes,
                    args.max_file_bytes + 1,
                }
            ):
                path = root / "padded.flac"
                padded_flac(source.read_bytes(), path, size)
                with path.open("rb") as stream:
                    response = client.post(
                        f"{args.url}/transcode",
                        params={"target": "mp3"},
                        files={"file": ("boundary.flac", stream, "audio/flac")},
                    )
                expected = 200 if size <= args.max_file_bytes else 413
                assert response.status_code == expected, (
                    size,
                    expected,
                    response.status_code,
                    response.text[:200] if response.status_code != 200 else "",
                )
                if expected == 200:
                    output = root / "output.mp3"
                    output.write_bytes(response.content)
                    probe = subprocess.run(
                        [
                            "ffprobe",
                            "-v",
                            "error",
                            "-show_entries",
                            "format=duration",
                            "-of",
                            "json",
                            str(output),
                        ],
                        check=True,
                        capture_output=True,
                        text=True,
                    )
                    assert float(json.loads(probe.stdout)["format"]["duration"]) > 0
                print(f"{size} bytes: HTTP {response.status_code}", flush=True)


if __name__ == "__main__":
    main()

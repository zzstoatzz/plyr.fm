#!/usr/bin/env python3
"""Generate podcast audio from a labeled script using Gemini TTS."""
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///

import argparse
import base64
import os
import re
from pathlib import Path
from typing import Any

from google import genai

SPEAKERS = {
    "Host": {
        "voice": "Kore",
        "style": "dry, matter-of-fact, slightly sardonic, with natural conversational pacing",
    },
    "Cohost": {
        "voice": "Puck",
        "style": "dry, curious, slightly sardonic, with natural conversational pacing",
    },
}
SPEAKER_LINE = re.compile(r"^(Host|Cohost):\s*(.*)$")


def parse_script(script: str) -> list[dict[str, Any]]:
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

    content: list[dict[str, Any]] = []
    for speaker, lines in turns:
        text = "\n".join(lines).strip()
        if not text:
            raise ValueError(f"{speaker} turn must not be empty")
        content.append(
            {
                "type": "text",
                "text": text,
                "annotations": [
                    {
                        "type": "speech_metadata",
                        "speaker": speaker,
                        "style": SPEAKERS[speaker]["style"],
                    }
                ],
            }
        )

    return content


def decode_wav(audio_data: str) -> bytes:
    wav_data = base64.b64decode(audio_data, validate=True)
    if len(wav_data) < 12 or wav_data[:4] != b"RIFF" or wav_data[8:12] != b"WAVE":
        raise ValueError("Gemini returned audio that is not a WAV file")
    return wav_data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("script_file", type=Path)
    parser.add_argument("output_file", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.script_file.exists():
        raise SystemExit(f"error: {args.script_file} not found")

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise SystemExit("error: GOOGLE_API_KEY not set")

    content = parse_script(args.script_file.read_text())
    print(
        f"generating audio from {args.script_file} "
        f"({len(content)} turns, model {args.model})"
    )

    client = genai.Client(api_key=api_key)
    interaction = client.interactions.create(
        model=args.model,
        input=[{"type": "user_input", "content": content}],
        response_format={"type": "audio"},
        generation_config={
            "speech_config": {
                "mode": "conversational",
                "speakers": [
                    {"speaker": speaker, "voice": config["voice"]}
                    for speaker, config in SPEAKERS.items()
                ],
            }
        },
    )

    if interaction.output_audio is None or interaction.output_audio.data is None:
        raise RuntimeError("Gemini returned no audio")
    wav_data = decode_wav(interaction.output_audio.data)
    args.output_file.write_bytes(wav_data)
    print(f"saved audio to {args.output_file} ({len(wav_data)} bytes)")


if __name__ == "__main__":
    main()

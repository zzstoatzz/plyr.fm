#!/usr/bin/env python3
"""Generate podcast audio from a labeled script using Gemini TTS."""
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///

import argparse
import base64
import io
import os
import re
import wave
from pathlib import Path
from typing import Any

from google import genai

SPEAKERS = {
    "Host": {
        "voice": "Kore",
        "style": "warm, clear and unhurried, like explaining something you know well to a friend; wry when something is funny",
    },
    "Cohost": {
        "voice": "Puck",
        "style": "curious and easygoing, quick to react; asks questions the way a listener would",
    },
}
DIRECTION = (
    "This is a relaxed two-person podcast about a music app. Read it as a real "
    "conversation between two friends at a kitchen table: natural pacing, small "
    "pauses between turns, reactions that sound spontaneous. Never sound like an "
    "announcer or an ad."
)
SPEAKER_LINE = re.compile(r"^(Host|Cohost)(?:\s*\[([^\]]+)\])?:\s*(.*)$")
MAX_CHUNK_WORDS = 700


def parse_script(
    script: str,
    speakers: dict[str, dict[str, str]] = SPEAKERS,
    direction: str | None = DIRECTION,
) -> list[dict[str, Any]]:
    turns: list[tuple[str, str | None, list[str]]] = []

    for line_number, line in enumerate(script.splitlines(), start=1):
        match = SPEAKER_LINE.match(line)
        if match:
            speaker, note, text = match.groups()
            turns.append((speaker, note, [text]))
        elif turns:
            turns[-1][2].append(line)
        elif line.strip():
            raise ValueError(f"line {line_number} must start with Host: or Cohost:")

    if not turns:
        raise ValueError("script must contain at least one Host: or Cohost: turn")

    content: list[dict[str, Any]] = []
    for speaker, note, lines in turns:
        text = "\n".join(lines).strip()
        if not text:
            raise ValueError(f"{speaker} turn must not be empty")
        style = speakers[speaker]["style"]
        if direction:
            style = f"{direction} This speaker: {style}"
        if note:
            style = f"{style}; for this line: {note.strip()}"
        content.append(
            {
                "type": "text",
                "text": text,
                "annotations": [
                    {"type": "speech_metadata", "speaker": speaker, "style": style}
                ],
            }
        )

    return content


def chunk_turns(
    content: list[dict[str, Any]], max_words: int = MAX_CHUNK_WORDS
) -> list[list[dict[str, Any]]]:
    chunks: list[list[dict[str, Any]]] = [[]]
    words = 0
    for turn in content:
        turn_words = len(turn["text"].split())
        if chunks[-1] and words + turn_words > max_words:
            chunks.append([])
            words = 0
        chunks[-1].append(turn)
        words += turn_words
    return chunks


def decode_wav(audio_data: str) -> bytes:
    wav_data = base64.b64decode(audio_data, validate=True)
    if len(wav_data) < 12 or wav_data[:4] != b"RIFF" or wav_data[8:12] != b"WAVE":
        raise ValueError("Gemini returned audio that is not a WAV file")
    return wav_data


def join_wavs(parts: list[bytes]) -> bytes:
    if len(parts) == 1:
        return parts[0]
    params = None
    frames: list[bytes] = []
    for part in parts:
        with wave.open(io.BytesIO(part)) as reader:
            if params is None:
                params = reader.getparams()
            elif reader.getparams()[:3] != params[:3]:
                raise ValueError("Gemini returned chunks with different audio formats")
            frames.append(reader.readframes(reader.getnframes()))
    assert params is not None
    out = io.BytesIO()
    with wave.open(out, "wb") as writer:
        writer.setparams(params)
        for chunk in frames:
            writer.writeframes(chunk)
    return out.getvalue()


def render(
    client: genai.Client,
    model: str,
    script: str,
    speakers: dict[str, dict[str, str]] = SPEAKERS,
    direction: str | None = DIRECTION,
) -> bytes:
    parts: list[bytes] = []
    for chunk in chunk_turns(parse_script(script, speakers, direction)):
        request: dict[str, Any] = {
            "model": model,
            "input": [{"type": "user_input", "content": chunk}],
            "response_format": {"type": "audio"},
            "generation_config": {
                "speech_config": {
                    "mode": "conversational",
                    "speakers": [
                        {"speaker": speaker, "voice": config["voice"]}
                        for speaker, config in speakers.items()
                    ],
                }
            },
        }
        interaction = client.interactions.create(**request)
        if interaction.output_audio is None or interaction.output_audio.data is None:
            raise RuntimeError("Gemini returned no audio")
        parts.append(decode_wav(interaction.output_audio.data))
    return join_wavs(parts)


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

    script = args.script_file.read_text()
    print(f"generating audio from {args.script_file} (model {args.model})")
    wav_data = render(genai.Client(api_key=api_key), args.model, script)
    args.output_file.write_bytes(wav_data)
    print(f"saved audio to {args.output_file} ({len(wav_data)} bytes)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Render status-podcast candidates from a spec, for side-by-side listening."""
# /// script
# requires-python = ">=3.11"
# dependencies = ["google-genai"]
# ///

import argparse
import json
import os
from pathlib import Path
from typing import Any

from generate_tts import DIRECTION, SPEAKERS, render
from google import genai


def list_voices(client: genai.Client) -> list[dict[str, Any]]:
    voices: list[dict[str, Any]] = []
    token: str | None = None
    while True:
        page = client.voices.list(
            language_code=["en-US"], page_size=1000, page_token=token
        )
        for voice in page.voices or []:
            voices.append(
                voice.model_dump(
                    exclude={"sample_audio", "usage"}, exclude_none=True, mode="json"
                )
            )
        token = page.next_page_token
        if not token:
            return voices


def speakers_for(variant: dict[str, Any]) -> dict[str, dict[str, str]]:
    speakers = {name: dict(config) for name, config in SPEAKERS.items()}
    for name, voice in variant.get("voices", {}).items():
        speakers[name]["voice"] = voice
    for name, style in variant.get("styles", {}).items():
        speakers[name]["style"] = style
    return speakers


def direction_for(variant: dict[str, Any]) -> str | None:
    direction = variant.get("direction", "default")
    if direction == "default":
        return DIRECTION
    if direction == "none":
        return None
    return direction


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", type=Path)
    parser.add_argument("out_dir", type=Path)
    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise SystemExit("error: GOOGLE_API_KEY not set")

    spec = json.loads(args.spec.read_text())
    args.out_dir.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=api_key)

    if spec.get("list_voices"):
        voices = list_voices(client)
        (args.out_dir / "voices.json").write_text(json.dumps(voices, indent=2))
        print(f"listed {len(voices)} voices")

    for variant in spec.get("variants", []):
        script_path = args.spec.parent / variant["script"]
        speakers = speakers_for(variant)
        print(
            f"rendering {variant['name']}: {script_path.name}, "
            f"voices {speakers['Host']['voice']}/{speakers['Cohost']['voice']}"
        )
        wav = render(
            client,
            variant.get("model", spec["model"]),
            script_path.read_text(),
            speakers,
            direction_for(variant),
        )
        (args.out_dir / f"{variant['name']}.wav").write_bytes(wav)
        (args.out_dir / f"{variant['name']}.txt").write_text(script_path.read_text())


if __name__ == "__main__":
    main()

"""Run the same blind pairs through Gemini using an in-memory store credential."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.27,<1", "numpy>=2,<3"]
# ///

import argparse
import asyncio
import base64
import json
import os
import wave
from pathlib import Path

import httpx
from listening import OUT, PROMPT


async def credential() -> str:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    process = await asyncio.create_subprocess_exec(
        "sops",
        "-d",
        "--output-type",
        "json",
        str(Path.home() / "tangled.org/zzstoatzz.io/secrets/prod.yaml"),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await process.communicate()
    if process.returncode:
        raise RuntimeError("Secret store unavailable")
    return json.loads(stdout)["local"]["gemini_api_key"]


def audio(path: Path) -> dict:
    return {
        "inline_data": {
            "mime_type": "audio/wav",
            "data": base64.b64encode(path.read_bytes()).decode(),
        }
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnostics", action="store_true")
    args = parser.parse_args()
    model = "gemini-3.5-flash-lite"
    async with httpx.AsyncClient(
        headers={"x-goog-api-key": await credential()}, timeout=90
    ) as client:
        for trial in ("same", "no_bass", "slower_beat", "late_melody", "distorted"):
            other = OUT / ("base.wav" if trial == "same" else f"{trial}.wav")
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                json={
                    "contents": [
                        {
                            "role": "user",
                            "parts": [
                                {"text": PROMPT + " Recording A:"},
                                audio(OUT / "base.wav"),
                                {"text": "Recording B:"},
                                audio(other),
                            ],
                        }
                    ],
                    "generationConfig": {"maxOutputTokens": 400, "temperature": 0},
                },
            )
            if response.status_code != 200:
                print(f"Gemini status {response.status_code}; stopping without retries")
                return
            data = response.json()
            for candidate in data.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    part.pop("thoughtSignature", None)
            result = {
                "trial": trial,
                "model": data.get("modelVersion", model),
                "candidates": data.get("candidates"),
                "usage": data.get("usageMetadata"),
            }
            await asyncio.to_thread(
                (OUT / f"gemini_{trial}.json").write_text, json.dumps(result, indent=2)
            )
            print(json.dumps(result), flush=True)
        if args.diagnostics:
            await asyncio.to_thread(controls)
            for trial, prompt in (
                (
                    "joined",
                    "Describe changes in the bass between the first and second halves of this audio. There is a one-second silent gap separating them.",
                ),
                (
                    "silence",
                    "Describe what you hear in this eight-second audio clip. Is there music, speech, or silence?",
                ),
                ("speech_control", "Transcribe the words in this audio."),
            ):
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    json={
                        "contents": [
                            {"parts": [{"text": prompt}, audio(OUT / f"{trial}.wav")]}
                        ],
                        "generationConfig": {"maxOutputTokens": 500, "temperature": 0},
                    },
                )
                response.raise_for_status()
                data = response.json()
                result = {
                    "model": model,
                    "prompt": prompt,
                    "response": "".join(
                        part.get("text", "")
                        for part in data["candidates"][0]["content"]["parts"]
                        if not part.get("thought")
                    ),
                    "usage": data.get("usageMetadata"),
                }
                await asyncio.to_thread(
                    (OUT / f"gemini_diagnostic_{trial}.json").write_text,
                    json.dumps(result, indent=2),
                )
                print(json.dumps(result), flush=True)


def controls() -> None:
    with wave.open(str(OUT / "base.wav"), "rb") as wav:
        params = wav.getparams()
        frames = wav.readframes(wav.getnframes())
    with wave.open(str(OUT / "no_bass.wav"), "rb") as wav:
        second = wav.readframes(wav.getnframes())
    for name, data in (
        ("silence", bytes(len(frames))),
        ("joined", frames + bytes(params.framerate * params.sampwidth) + second),
    ):
        with wave.open(str(OUT / f"{name}.wav"), "wb") as wav:
            wav.setparams(params)
            wav.writeframes(data)


if __name__ == "__main__":
    asyncio.run(main())

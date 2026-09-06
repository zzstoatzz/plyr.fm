"""Bounded, blind audio comparison experiment; run with uv run listening.py."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.27,<1", "numpy>=2,<3"]
# ///

import argparse
import asyncio
import base64
import hashlib
import json
import os
import wave
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).parent
OUT = ROOT / "results"
RATE = 24000
PROMPT = (
    "Compare recording A with recording B by listening. They may be identical. "
    "Describe only audible differences in bass, rhythm, melody entrance, and timbre. "
    "Do not assume a difference exists. Give approximate timestamps where useful. "
    "State uncertainty. Keep your answer under 150 words."
)


def render(
    name: str,
    bass: float = 0.2,
    beat: float = 0.5,
    entrance: float = 0.0,
    distortion: bool = False,
) -> Path:
    """Render the same eight-second phrase with controlled variations."""
    t = np.arange(RATE * 8) / RATE
    signal = np.zeros_like(t)
    for start in np.arange(0, 8, beat):
        dt = t - start
        env = np.exp(-np.maximum(dt, 0) * 35) * (dt >= 0)
        signal += 0.13 * np.sin(2 * np.pi * 90 * dt) * env
    for i, frequency in enumerate([261.63, 329.63, 392, 329.63] * 4):
        dt = t - (entrance + i * 0.5)
        env = np.minimum(np.maximum(dt, 0) / 0.02, 1)
        env *= np.exp(-np.maximum(dt, 0) * 6) * (dt >= 0) * (dt < 0.45)
        signal += 0.15 * np.sin(2 * np.pi * frequency * dt) * env
    signal += bass * np.sin(2 * np.pi * 65.41 * t)
    if distortion:
        signal = np.tanh(signal * 12) * 0.4
    signal *= np.minimum(t / 0.03, 1) * np.minimum((8 - t) / 0.08, 1)
    path = OUT / f"{name}.wav"
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((signal * 32767).astype("<i2").tobytes())
    return path


async def credential() -> str:
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]
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
    value = json.loads(stdout)["prefect"]["blocks"]["openai-api-key"]
    if isinstance(value, dict):
        value = value["value"]
    return value


def audio(path: Path) -> dict:
    return {
        "type": "input_audio",
        "input_audio": {
            "data": base64.b64encode(path.read_bytes()).decode(),
            "format": "wav",
        },
    }


async def compare(
    client: httpx.AsyncClient,
    a: Path,
    b: Path,
    trial: str,
    model: str = "gpt-audio-mini",
) -> dict:
    response = await client.post(
        "https://api.openai.com/v1/chat/completions",
        json={
            "model": model,
            "modalities": ["text"],
            "max_completion_tokens": 350,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT + " Recording A:"},
                        audio(a),
                        {"type": "text", "text": "Recording B:"},
                        audio(b),
                    ],
                }
            ],
        },
    )
    if response.status_code != 200:
        error = response.json().get("error", {})
        result = {
            "trial": trial,
            "status": response.status_code,
            "error_type": error.get("type"),
            "error_code": error.get("code"),
        }
    else:
        data = response.json()
        result = {
            "trial": trial,
            "model": data["model"],
            "response": data["choices"][0]["message"]["content"],
            "usage": data["usage"],
            "finish_reason": data["choices"][0]["finish_reason"],
            "a_sha256": hashlib.sha256(a.read_bytes()).hexdigest(),
            "b_sha256": hashlib.sha256(b.read_bytes()).hexdigest(),
        }
    (OUT / f"{trial}.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result), flush=True)
    return result


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagnostics", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    base = await asyncio.to_thread(render, "base")
    variants = {
        "same": base,
        "no_bass": await asyncio.to_thread(render, "no_bass", bass=0),
        "slower_beat": await asyncio.to_thread(render, "slower_beat", beat=1),
        "late_melody": await asyncio.to_thread(render, "late_melody", entrance=2),
        "distorted": await asyncio.to_thread(render, "distorted", distortion=True),
    }
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {await credential()}"},
        timeout=90,
    ) as client:
        for name, clip in variants.items():
            result = await compare(client, base, clip, name)
            if "status" in result:
                break
        if args.diagnostics:
            for name in ("same", "no_bass", "late_melody"):
                await compare(
                    client, base, variants[name], f"full_{name}", "gpt-audio-1.5"
                )
            await single_clip(
                client,
                base,
                "single",
                "gpt-audio-mini",
                "Describe the sounds in this eight-second audio clip.",
            )
            response = await client.post(
                "https://api.openai.com/v1/audio/speech",
                json={
                    "model": "tts-1",
                    "voice": "alloy",
                    "response_format": "wav",
                    "input": "The blue bicycle has seven wheels.",
                },
            )
            response.raise_for_status()
            speech = OUT / "speech_control.wav"
            await asyncio.to_thread(speech.write_bytes, response.content)
            for model in ("gpt-audio-mini", "gpt-audio-1.5"):
                await single_clip(
                    client,
                    speech,
                    f"speech_{model}",
                    model,
                    "Transcribe the words in this audio.",
                )


async def single_clip(
    client: httpx.AsyncClient, path: Path, trial: str, model: str, prompt: str
) -> None:
    response = await client.post(
        "https://api.openai.com/v1/chat/completions",
        json={
            "model": model,
            "modalities": ["text"],
            "max_completion_tokens": 250,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        audio(path),
                    ],
                }
            ],
        },
    )
    response.raise_for_status()
    data = response.json()
    result = {
        "model": data["model"],
        "choices": data["choices"],
        "usage": data["usage"],
    }
    await asyncio.to_thread(
        (OUT / f"{trial}.json").write_text, json.dumps(result, indent=2)
    )
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    asyncio.run(main())

"""Render the peer responses with the CC0 VCSL concert harp."""

import asyncio
import hashlib
import json
import math
import subprocess
import wave
from urllib.parse import quote

import httpx
import numpy as np
from dac import Sample, note_to_freq
from dac.track import RenderConfig, mix
from taste import OUT, PROFILES

COMMIT = "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e"


def render_harp(score: dict, name: str) -> dict:
    tracks = []
    for i, (note, start, duration) in enumerate(score["events"]):
        anchor = "C5" if note_to_freq(note) >= note_to_freq("A4") else "D4"
        shift = 12 * math.log2(note_to_freq(note) / note_to_freq(anchor))
        t = Sample(OUT / f"harp_{anchor}.wav", label=f"h{i}")
        t.pitch(shift).trim(duration).lowpass(score["lowpass"])
        t.fade_in(min(score["attack"], duration / 3))
        release = min(score["release"], duration / 2)
        t.fade_out(release, start=duration - release).delay(round(start * 1000)).pad(10)
        t.volume(0.12)
        tracks.append(t)
    path = OUT / f"{name}_harp.wav"
    mix(
        tracks, path, config=RenderConfig(duration=10, sample_rate=24000, limit_db=None)
    )
    with wave.open(str(path), "rb") as w:
        x = (
            np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float)
            / 32768
        )
    x *= min(10 ** (-22 / 20) / np.sqrt(np.mean(x * x)), 0.89 / max(abs(x)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    return {
        "duration": len(x) / 24000,
        "rms_dbfs": float(20 * np.log10(np.sqrt(np.mean(x * x)))),
        "peak_dbfs": float(20 * np.log10(max(abs(x)))),
    }


async def main() -> None:
    sources = []
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
        for note in ("D4", "C5"):
            relative = f"Chordophones/Composite Chordophones/Concert Harp/KSHarp_{note}_mf1.wav"
            url = f"https://raw.githubusercontent.com/sgossner/VCSL/{COMMIT}/{quote(relative)}"
            r = await c.get(url)
            r.raise_for_status()
            source = OUT / f"source_{note}.wav"
            source.write_bytes(r.content)
            await asyncio.to_thread(
                subprocess.run,
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(source),
                    "-ar",
                    "48000",
                    "-y",
                    str(OUT / f"harp_{note}.wav"),
                ],
                check=True,
            )
            sources.append(
                {
                    "url": url,
                    "sha256": hashlib.sha256(r.content).hexdigest(),
                    "license": "CC0",
                }
            )
    renders = {}
    for person in PROFILES:
        score = json.loads((OUT / f"{person}_peer.json").read_text())["answer"]["score"]
        renders[person] = await asyncio.to_thread(render_harp, score, person)
    (OUT / "harp.json").write_text(
        json.dumps({"sources": sources, "renders": renders}, indent=2)
    )
    print(json.dumps(renders, indent=2))


if __name__ == "__main__":
    asyncio.run(main())

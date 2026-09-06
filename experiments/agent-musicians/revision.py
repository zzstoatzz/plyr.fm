"""Ask Luna to revise from measurements; no claim of direct audio perception."""

# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx>=0.27,<1", "numpy>=2,<3"]
# ///

import asyncio
import json
import tempfile
import wave
from pathlib import Path

import numpy as np
from listening import OUT, render


def metrics(path: Path) -> dict[str, float]:
    with wave.open(str(path), "rb") as wav:
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2") / 32768
        rate = wav.getframerate()
    frequencies = np.fft.rfftfreq(len(samples), 1 / rate)
    energy = abs(np.fft.rfft(samples)) ** 2
    return {
        "duration_seconds": len(samples) / rate,
        "peak_dbfs": float(20 * np.log10(max(abs(samples)))),
        "rms_dbfs": float(20 * np.log10(np.sqrt(np.mean(samples * samples)))),
        "energy_below_150hz_fraction": float(
            energy[frequencies < 150].sum() / energy.sum()
        ),
    }


async def main() -> None:
    OUT.mkdir(exist_ok=True)
    base = await asyncio.to_thread(render, "base")
    before = await asyncio.to_thread(metrics, base)
    prompt = (
        "You are the composer of an eight-second synthetic phrase. You have NOT heard it. "
        f"Use only these measured features: {json.dumps(before)}. "
        "The current renderer has bass amplitude 0.20 and melody amplitude 0.15; "
        "melody repeats C4 E4 G4 E4 at half-second intervals. "
        "Goal: make the melody less masked by low frequencies, preserving notes and timing. "
        "Return ONLY JSON with bass_amplitude (0 to 0.20), explanation (one sentence "
        "acknowledging no direct listening), and predicted_energy_change. "
        "Do not claim musical quality improved."
    )
    with tempfile.TemporaryDirectory(prefix="plyr-listening-") as directory:
        process = await asyncio.create_subprocess_exec(
            "pi",
            "--model",
            "openai-codex/gpt-5.6-luna",
            "--no-session",
            "--no-extensions",
            "--no-context-files",
            "--no-skills",
            "--no-prompt-templates",
            "--no-builtin-tools",
            "--print",
            "--mode",
            "json",
            prompt,
            cwd=directory,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=120)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise
    if process.returncode:
        raise RuntimeError(f"Pi failed with status {process.returncode}")
    messages = [
        json.loads(line) for line in stdout.decode().splitlines() if line.strip()
    ]
    message = next(
        item["message"]
        for item in reversed(messages)
        if item.get("type") == "message_end"
        and item.get("message", {}).get("role") == "assistant"
    )
    text = "".join(
        part["text"] for part in message["content"] if part["type"] == "text"
    )
    decision = json.loads(text)
    amplitude = float(decision["bass_amplitude"])
    if not 0 <= amplitude <= 0.2:
        raise ValueError("Luna returned an out-of-range amplitude")
    revised = await asyncio.to_thread(render, "revised", bass=amplitude)
    after = await asyncio.to_thread(metrics, revised)
    result = {
        "model": message["model"],
        "prompt": prompt,
        "decision": decision,
        "usage": message.get("usage"),
        "before": before,
        "after": after,
    }
    await asyncio.to_thread(
        (OUT / "revision.json").write_text, json.dumps(result, indent=2)
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())

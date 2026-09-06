"""Score-grounded musician preference and composition experiment."""

import asyncio
import itertools
import json
import tempfile
import wave
from pathlib import Path

import numpy as np
from dac.compose import Voice
from dac.track import RenderConfig, mix

OUT = Path(__file__).parent / "taste-results"
PROFILES = {
    "moss": "You value sustained harmony, common tones, gentle harmonic movement and overlapping voices. You dislike busy repetition without harmonic purpose.",
    "kite": "You value syncopation, rhythmic variation, crisp articulation and playful momentum. You dislike music that remains static.",
    "reed": "You value sparse melodic gestures, expressive rests and clear phrase endings. You dislike continuous sound that leaves no room for a phrase to breathe.",
}
SCORES = {
    "harmony": {
        "attack": 0.5,
        "release": 0.8,
        "lowpass": 900,
        "events": [
            ["G3", 0, 4.8],
            ["B3", 0, 4.8],
            ["D4", 0, 4.8],
            ["F#4", 0, 9.5],
            ["D3", 4.5, 5],
            ["A3", 4.5, 5],
            ["C#4", 4.5, 5],
        ],
    },
    "rhythm": {
        "attack": 0.015,
        "release": 0.12,
        "lowpass": 3500,
        "events": [
            ["D4", 0, 0.35],
            ["A4", 0.75, 0.25],
            ["F#4", 1.25, 0.4],
            ["E4", 2, 0.3],
            ["D4", 2.75, 0.5],
            ["A4", 3.5, 0.3],
            ["B4", 4.25, 0.25],
            ["A4", 5, 0.4],
            ["F#4", 5.75, 0.3],
            ["E4", 6.25, 0.4],
            ["A4", 7, 0.3],
            ["D4", 8, 1],
        ],
    },
    "space": {
        "attack": 0.08,
        "release": 0.5,
        "lowpass": 1800,
        "events": [
            ["D4", 0.4, 0.8],
            ["F#4", 1.5, 1.2],
            ["A4", 4, 1],
            ["E4", 6, 0.7],
            ["D4", 8, 1.4],
        ],
    },
}
LIMIT = asyncio.Semaphore(3)


async def ask(prompt: str, name: str) -> dict:
    async with LIMIT:
        with tempfile.TemporaryDirectory(prefix="plyr-taste-") as directory:
            proc = await asyncio.create_subprocess_exec(
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
                stdout, _ = await asyncio.wait_for(proc.communicate(), 120)
            except TimeoutError:
                proc.kill()
                await proc.wait()
                raise
        if proc.returncode:
            raise RuntimeError(f"Pi failed: {name}, status {proc.returncode}")
        events = [
            json.loads(line) for line in stdout.decode().splitlines() if line.strip()
        ]
        message = next(
            e["message"]
            for e in reversed(events)
            if e.get("type") == "message_end"
            and e.get("message", {}).get("role") == "assistant"
        )
        text = "".join(p["text"] for p in message["content"] if p["type"] == "text")
        result = {
            "prompt": prompt,
            "answer": json.loads(text),
            "model": message["model"],
            "usage": message.get("usage"),
        }
        (OUT / f"{name}.json").write_text(json.dumps(result, indent=2))
        print(name, json.dumps(result["answer"]), flush=True)
        return result


def render(score: dict, name: str) -> dict:
    events = score["events"]
    if not 1 <= len(events) <= 16:
        raise ValueError("Expected 1–16 note events")
    attack, release, lowpass = (
        float(score[k]) for k in ("attack", "release", "lowpass")
    )
    if (
        not 0.005 <= attack <= 1
        or not 0.02 <= release <= 2
        or not 200 <= lowpass <= 5000
    ):
        raise ValueError("Envelope/filter outside allowed range")
    tracks = []
    for i, (note, start, duration) in enumerate(events):
        start, duration = float(start), float(duration)
        if not 0 <= start < 10 or not 0.1 <= duration <= 10 - start:
            raise ValueError("Note outside ten-second window")
        voice = Voice(
            note,
            duration,
            amplitude=0.08,
            attack=min(attack, duration / 3),
            release=min(release, duration / 2),
            lowpass=lowpass,
            label=f"n{i}",
        )
        tracks.extend(voice.render(delay_ms=round(start * 1000)))
    path = OUT / f"{name}.wav"
    mix(
        tracks,
        path,
        config=RenderConfig(duration=10, sample_rate=24000, channels=1, limit_db=None),
    )
    with wave.open(str(path), "rb") as wav:
        x = (
            np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(float)
            / 32768
        )
    rms = np.sqrt(np.mean(x * x))
    gain = min(10 ** (-22 / 20) / rms, 0.89 / max(abs(x)))
    x *= gain
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes((x * 32767).astype("<i2").tobytes())
    return {
        "events": len(events),
        "rms_dbfs": float(20 * np.log10(np.sqrt(np.mean(x * x)))),
        "peak_dbfs": float(20 * np.log10(max(abs(x)))),
        "duration": len(x) / 24000,
    }


async def main() -> None:
    OUT.mkdir(exist_ok=True)
    renders = {}
    for name, score in SCORES.items():
        renders[name] = await asyncio.to_thread(render, score, name)

    async def preferences(person: str) -> dict:
        results = []
        for i, (left, right) in enumerate(itertools.permutations(SCORES, 2)):
            prompt = (
                PROFILES[person]
                + " You have not heard audio. Judge only the supplied scores. "
                "Each score lasts ten seconds; events are [pitch, onset seconds, duration seconds]. "
                "Which would you choose to study for your own next composition? "
                "Return only JSON: choice ('A' or 'B'), reason (one sentence citing a concrete feature), "
                "tradeoff (one sentence naming something you lose by choosing it). "
                f"A: {json.dumps(SCORES[left])} B: {json.dumps(SCORES[right])}"
            )
            result = await ask(prompt, f"{person}_choice_{i}")
            choice = result["answer"]["choice"]
            if choice not in ("A", "B"):
                raise ValueError("Invalid choice")
            results.append(
                {
                    "left": left,
                    "right": right,
                    "chosen": left if choice == "A" else right,
                }
            )
        wins = {name: sum(r["chosen"] == name for r in results) for name in SCORES}
        preferred = max(wins, key=wins.get)
        prompt = (
            PROFILES[person]
            + " You have not heard any audio. Your previous score-based choices favored "
            f"this score: {json.dumps(SCORES[preferred])}. Create a ten-second response that borrows "
            "one specific feature but changes the music. Keep the result recognizable as a response, "
            "not a copy. Return only JSON: borrowed (one sentence), changed (one sentence), score "
            "with attack (.005 to 1 seconds), release (.02 to 2 seconds), lowpass (200 to 5000 Hz), "
            "events (1 to 16 [pitch like D4, onset seconds, duration seconds] entries). "
            "Each note must last at least .1 seconds and finish by second 10. Use pitched notes C3 through B5."
        )
        composition = await ask(prompt, f"{person}_response")
        renders[person] = await asyncio.to_thread(
            render, composition["answer"]["score"], person
        )
        consistent = sum(
            next(r["chosen"] for r in results if r["left"] == a and r["right"] == b)
            == next(r["chosen"] for r in results if r["left"] == b and r["right"] == a)
            for a, b in itertools.combinations(SCORES, 2)
        )
        return {
            "profile": PROFILES[person],
            "wins": wins,
            "preferred": preferred,
            "order_consistent_pairs": consistent,
            "pairs": 3,
            "choices": results,
        }

    results = await asyncio.gather(*(preferences(person) for person in PROFILES))
    cost = sum(
        json.loads(p.read_text()).get("usage", {}).get("cost", {}).get("total", 0)
        for p in OUT.glob("*.json")
        if p.name != "summary.json"
    )
    summary = {
        "musicians": dict(zip(PROFILES, results, strict=True)),
        "renders": renders,
        "estimated_usd": cost,
        "limitation": "Assigned aesthetic briefs; score-only reasoning; no evidence of audio perception or spontaneous preference formation.",
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(main())

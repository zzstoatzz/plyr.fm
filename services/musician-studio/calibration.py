"""Blind, factual audio controls; these measure perception, not musical taste."""

import hashlib
import json
import random
from pathlib import Path
from typing import Literal

import numpy as np
from prefect import task
from prefect.artifacts import create_markdown_artifact
from prefect.cache_policies import NO_CACHE
from pydantic import BaseModel, Field

from studio.audio_model import request_audio
from studio.state import Store
from studio_instruments import SAMPLE_RATE, Audio, mix_voice, pitched_note, write_track

ControlKind = Literal[
    "silence", "regular_noise_pulses", "separated_notes", "stacked_notes"
]


class HeardControl(BaseModel):
    kind: ControlKind
    confidence: float = Field(ge=0, le=1)
    description: str = Field(min_length=1, max_length=800)


def control_audio(kind: ControlKind, variation: int) -> Audio:
    audio = np.zeros((10 * SAMPLE_RATE, 2))
    if kind == "regular_noise_pulses":
        rng = np.random.default_rng(variation)
        t = np.arange(round(0.06 * SAMPLE_RATE)) / SAMPLE_RATE
        noise = rng.normal(0, 1, len(t)) * np.sin(np.pi * t / 0.06) ** 2
        for beat in range(1, 9):
            mix_voice(audio, noise, float(beat), 0.15)
    elif kind != "silence":
        for index, note in enumerate([60, 64, 67, 72]):
            start = 1 + index * 2 if kind == "separated_notes" else 1
            mix_voice(audio, pitched_note(note + variation, 0.45), start, 0.2)
    peak = float(np.max(np.abs(audio)))
    if peak:
        audio *= 0.5 / peak
    return audio


@task(name="calibrate-audio-listener", cache_policy=NO_CACHE, persist_result=False)
def calibrate_listener(directory: Path, session: str) -> dict:
    store = Store(directory)
    saved = store.study(session, "listener-calibration") or {}
    results = saved.get("results", [])
    cases: list[tuple[ControlKind, int]] = [
        ("silence", 0),
        ("silence", 1),
        ("regular_noise_pulses", 0),
        ("regular_noise_pulses", 1),
        ("separated_notes", 0),
        ("stacked_notes", 0),
    ]
    random.Random(session).shuffle(cases)
    folder = directory / session / "listener-calibration"
    folder.mkdir(parents=True, exist_ok=True)
    prompt = (
        "Listen to this ten-second recording. Classify the actual audio as silence "
        "(no audible events), regular_noise_pulses (repeated unpitched noise bursts), "
        "separated_notes (pitched notes occurring one after another across the recording), "
        "or stacked_notes (pitched notes sounding together as one event). "
        "Report kind, confidence from 0 to 1, and a short description of the audible timing. "
        "Silence is a valid answer. Do not invent a musical narrative. Return only JSON."
    )
    for index, (expected, variation) in enumerate(cases):
        path = folder / f"{index}.wav"
        write_track(control_audio(expected, variation), str(path))
        if index < len(results):
            if (
                results[index]["audio_sha256"]
                != hashlib.sha256(path.read_bytes()).hexdigest()
            ):
                raise ValueError("Calibration audio changed during recovery")
            continue
        answer, receipt = request_audio(store, session, path, prompt, HeardControl)
        results.append(
            {
                "index": index,
                "expected": expected,
                **answer.model_dump(),
                **receipt.model_dump(),
                "correct": answer.kind == expected,
            }
        )
        store.save_study(session, "listener-calibration", {"results": results})
    summary = {
        "results": results,
        "correct": sum(result["correct"] for result in results),
        "total": len(cases),
        "scope": "Basic audio perception; not evidence of musical taste or reliable critique",
    }
    (folder / "results.json").write_text(json.dumps(summary, indent=2))
    create_markdown_artifact(
        key="plyr-fm-listener-calibration",
        markdown=(
            f"# Listener calibration: {summary['correct']}/{summary['total']} correct\n\n"
            + summary["scope"]
            + "\n\n"
            + "\n\n".join(
                f"{r['index']}: expected {r['expected']}; heard {r['kind']} "
                f"(confidence {r['confidence']}, {r['audio_tokens']} audio tokens). {r['description']}"
                for r in results
            )
        ),
    )
    return summary

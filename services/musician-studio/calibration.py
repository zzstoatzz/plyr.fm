"""Blind, factual audio controls; these measure perception, not musical taste."""

import hashlib
import json
import random
from pathlib import Path
from typing import Literal, cast

import numpy as np
from prefect import task
from prefect.artifacts import create_markdown_artifact
from prefect.cache_policies import NO_CACHE
from pydantic import BaseModel, Field

from studio.audio_model import request_audio
from studio.state import Store
from studio_instruments import (
    SAMPLE_RATE,
    Audio,
    drum_hit,
    mix_voice,
    pitched_note,
    write_track,
)

CalibrationSuite = Literal["basic", "arrangement"]

ControlKind = Literal[
    "silence", "regular_noise_pulses", "separated_notes", "stacked_notes"
]


class HeardControl(BaseModel):
    kind: ControlKind
    confidence: float = Field(ge=0, le=1)
    description: str = Field(min_length=1, max_length=800)


class HeardArrangement(BaseModel):
    bass_entry: Literal["opening", "delayed", "absent"]
    motif_change: Literal["same", "higher_ending"]
    confidence: float = Field(ge=0, le=1)
    description: str = Field(min_length=1, max_length=800)


def arrangement_audio(bass_entry: str, changed: bool) -> Audio:
    audio = np.zeros((10 * SAMPLE_RATE, 2))
    for beat in range(20):
        mix_voice(audio, drum_hit("hat", seed=beat), beat / 2, 0.025, 0.3)
    for start in (0, 4, 8):
        for note in (60, 64, 67):
            mix_voice(audio, pitched_note(note, 1.8, "pad"), start, 0.055, -0.2)
    if bass_entry != "absent":
        for beat in range(0 if bass_entry == "opening" else 6, 20):
            mix_voice(audio, pitched_note(36, 0.28, "bass"), beat / 2, 0.4)
    for repeat, start in enumerate((1.5, 5.5)):
        for index, note in enumerate((72, 76, 79)):
            if repeat and index == 2 and changed:
                note = 84
            mix_voice(audio, pitched_note(note, 0.4), start + index * 0.5, 0.3, 0.15)
    return audio


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
def calibrate_listener(
    directory: Path, session: str, suite: CalibrationSuite = "basic"
) -> dict:
    store = Store(directory)
    saved = store.study(session, "listener-calibration") or {}
    if saved and saved.get("suite", "basic") != suite:
        raise ValueError("Cannot change calibration suite during recovery")
    store.save_study(session, "listener-calibration", {"suite": suite})
    results = saved.get("results", [])
    cases: list[tuple[str, int]] = [
        ("silence", 0),
        ("silence", 1),
        ("regular_noise_pulses", 0),
        ("regular_noise_pulses", 1),
        ("separated_notes", 0),
        ("stacked_notes", 0),
    ]
    if suite == "arrangement":
        cases = [
            (entry, changed)
            for entry in ("opening", "delayed", "absent")
            for changed in (0, 1)
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
    if suite == "arrangement":
        prompt = (
            "Listen to this ten-second arrangement with a chord background, light high percussion, "
            "and two statements of a high three-note melody. Report whether a separate low pulsing "
            "bass is present from the opening (opening), first enters partway through (delayed), "
            "or never appears (absent). Do not mistake the chord background for the bass. "
            "Compare the second melody statement with the first: are its pitches the same (same), "
            "or does its final note end higher (higher_ending)? Report bass_entry, motif_change, "
            "confidence from 0 to 1, and a short description of what you actually hear. Return only JSON."
        )
    for index, (expected, variation) in enumerate(cases):
        path = folder / f"{index}.wav"
        audio = (
            arrangement_audio(expected, bool(variation))
            if suite == "arrangement"
            else control_audio(cast(ControlKind, expected), variation)
        )
        write_track(audio, str(path))
        if index < len(results):
            if (
                results[index]["audio_sha256"]
                != hashlib.sha256(path.read_bytes()).hexdigest()
            ):
                raise ValueError("Calibration audio changed during recovery")
            continue
        schema = HeardArrangement if suite == "arrangement" else HeardControl
        answer, receipt = request_audio(store, session, path, prompt, schema)
        observed = answer.model_dump()
        fields = ("bass_entry", "motif_change") if suite == "arrangement" else ("kind",)
        target = (
            {
                "bass_entry": expected,
                "motif_change": "higher_ending" if variation else "same",
            }
            if suite == "arrangement"
            else {"kind": expected}
        )
        matches = {field: observed[field] == target[field] for field in fields}
        results.append(
            {
                "index": index,
                "expected": target if suite == "arrangement" else expected,
                **answer.model_dump(),
                **receipt.model_dump(),
                "correct": all(matches.values()),
                "field_correct": matches,
            }
        )
        store.save_study(
            session, "listener-calibration", {"suite": suite, "results": results}
        )
    summary = {
        "results": results,
        "correct": sum(result["correct"] for result in results),
        "total": len(cases),
        "suite": suite,
        "scope": "Controlled audio perception; not evidence of musical taste or reliable critique",
    }
    (folder / "results.json").write_text(json.dumps(summary, indent=2))
    create_markdown_artifact(
        key="plyr-fm-listener-calibration",
        markdown=(
            f"# Listener calibration: {summary['correct']}/{summary['total']} correct\n\n"
            + summary["scope"]
            + "\n\n"
            + "\n\n".join(
                f"{r['index']}: expected {r['expected']}; heard {r.get('kind', {k: r[k] for k in ('bass_entry', 'motif_change') if k in r})} "
                f"(confidence {r['confidence']}, {r['audio_tokens']} audio tokens). {r['description']}"
                for r in results
            )
        ),
    )
    return summary

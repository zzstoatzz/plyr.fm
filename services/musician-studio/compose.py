"""Compose Python music locally and render it in an isolated container."""

import argparse
import ast
import json
import os
import shutil
import subprocess
import tempfile
import uuid
import wave
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from prefect import task
from prefect.cache_policies import INPUTS, TASK_SOURCE
from prefect.context import FlowRunContext
from pydantic import BaseModel, Field

from studio.context import history_context, musical_identity
from studio.identity import Inspiration, Musician, Taste
from studio.state import Store

ROOT = Path(__file__).parent


class MusicalPlan(BaseModel):
    tempo_bpm: float = Field(gt=0, le=400)
    meter: str = Field(min_length=1, max_length=300)
    tonal_organization: str = Field(min_length=20, max_length=1000)
    motif: str = Field(min_length=20, max_length=1000)
    instrument_roles: list[str] = Field(min_length=1, max_length=6)
    development: str = Field(min_length=20, max_length=1000)


def plan_music(
    profile: Musician, previous: list[dict], store: Store, session: str, name: str
) -> MusicalPlan:
    saved = store.study(session, name) or {}
    if saved.get("musical_plan"):
        return MusicalPlan.model_validate(saved["musical_plan"])
    prompt = (
        "Plan a ten-second piece before writing any synthesis code. "
        "Use your inspirations and lessons from previous audio reviews. "
        "Choose a coherent musical idea that can be recognized by listening. "
        "Specify tempo and meter (or explain free timing), a tonal center/mode and chord or "
        "pitch relationships, a short motif with concrete notes or intervals and rhythmic values, "
        "the role/register of each instrument, and how the phrase develops and ends within ten seconds. "
        "Relate bass notes and voicings to the motif; use repetition with purposeful variation, "
        "space, phrasing and tension/release. Texture alone is not a composition plan. "
        "Non-tonal and percussion-led music are welcome: explain the organizing relationships "
        "instead of inventing a key or forcing melody or chords. A single voice can be sufficient. "
        "Avoid unrelated effects and competing ideas. Pick the few musical relationships that matter. "
        "Return only JSON matching this schema: "
        + json.dumps(MusicalPlan.model_json_schema())
        + "\nMusician: "
        + json.dumps(musical_identity(profile))
        + "\nPrevious work and heard feedback: "
        + json.dumps(history_context(previous, include_code=False))
    )
    plan = MusicalPlan.model_validate_json(request_music(prompt, store, session))
    store.save_study(session, name, {"musical_plan": plan.model_dump()})
    return plan


class Composition(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    idea: str = Field(min_length=1, max_length=1500)
    python: str = Field(min_length=1, max_length=40000)
    memory: str = Field(default="", max_length=1500)
    peer_note: str = Field(default="", max_length=1500)
    keep_peer: bool = False
    taste: Taste | None = None
    inspirations: list[Inspiration] | None = Field(
        default=None, min_length=1, max_length=4
    )


def compose(
    profile: Musician,
    previous: list[dict],
    store: Store,
    session: str,
    *,
    musician_id: str | None = None,
    peer: dict | None = None,
    revision: str | None = None,
) -> Composition:
    name = musician_id or profile.name.lower()
    plan = plan_music(profile, previous, store, session, name)
    prompt = (
        "Make a ten-second piece of music as this musician. Use Python and numpy to create the audio. "
        "You control the instruments, synthesis, musical structure, rhythm, harmony, and mix. "
        "Write a complete executable script using numpy, the Python standard library, and optionally studio_instruments. "
        "Implement this musical plan, prioritizing audible phrasing and relationships over effects: "
        + plan.model_dump_json()
        + "\nOptional tested tools from studio_instruments: SAMPLE_RATE=44100; "
        "note_hz(midi) supports fractional MIDI; beat_seconds(beat,bpm) converts beats to seconds; "
        "pitched_note(midi,seconds,voice='pluck') returns mono numpy audio, voice is pluck/bass/pad, "
        "duration includes release; drum_hit(voice,seed=0) returns a 0.3-second kick/snare/hat; "
        "mix_voice(stereo,mono,start,gain=0.2,pan=0) adds a voice in-place at start SECONDS, "
        "pan -1..1; write_track(stereo,path='/output/track.wav') fades endpoints and prevents clipping. "
        "Create stereo with np.zeros((441000,2)). Layer chord notes with mix_voice, "
        "schedule beats through beat_seconds, and leave room for note releases. "
        "Start with these instruments for ordinary pitched and percussion parts; write custom synthesis "
        "when a particular sound calls for it. Do not copy an old synthesizer merely because it appears in history. "
        "You may transform these sounds or synthesize your own. They impose no notes, chords or genre. "
        "It must write /output/track.wav as ten seconds of 16-bit PCM stereo at 44100 Hz. "
        "The environment has no network or external files; runtime is limited to 30 seconds and 512 MB. "
        "Avoid clipping. Choose a title for this particular composition. "
        "Identity and inspirations: "
        + json.dumps(musical_identity(profile))
        + "\nYour earlier work (code and intentions, not an audio listening experience): "
        + json.dumps(history_context(previous, include_code=revision is not None))
        + "\nPeer work, if available: "
        + json.dumps(peer)
        + "\nYou have code, not auditory perception. Respond to the peer if their work interests you. "
        "Set KEEP_PEER to a literal bool for whether to include their track in your playlist and PEER_NOTE "
        "to a short reason. Set MEMORY to what you want your future self to remember about this piece. "
        "If your preferences or influences have changed, optionally include TASTE (a literal dictionary using your existing dimensions) "
        "or INSPIRATIONS (a literal list using the existing inspiration fields). Otherwise omit them. "
        + "\nAudio review instructions for this revision: "
        + (revision or "First draft; audio review follows rendering.")
        + "\nReturn only executable Python source, no JSON or markdown. Include TITLE and IDEA as string constants."
    )
    if len(prompt.encode()) > 48000:
        raise ValueError("Composition context exceeds 48 KB")
    source = request_music(prompt, store, session)
    for attempt in range(2):
        if source.startswith("```python\n") and source.endswith("```"):
            source = source[len("```python\n") : -3].strip()
        store.save_study(session, name, {"source": source})
        try:
            return parse_composition(source)
        except SyntaxError as error:
            if attempt:
                raise
            store.save_study(
                session,
                name,
                {"syntax_failure": {"source": source, "error": str(error)}},
            )
            source = request_music(
                "Correct the Python syntax error in this music script. Preserve the composition, "
                "metadata and musical intent. Return the complete executable Python source only. "
                "It must still write /output/track.wav; no extra tools are available.\n"
                + f"Compiler error: {error}\nSource:\n{source}",
                store,
                session,
            )
    raise AssertionError("Unreachable composition attempt")


def request_music(prompt: str, store: Store, session: str) -> str:
    operation = composition_request.with_options(
        result_storage=store.path.parent / "prefect-results"
    )
    call = operation if FlowRunContext.get() else operation.fn
    return call(prompt, store.path.parent, session, "openai-codex/gpt-5.6-luna")


@task(name="write-music-python", cache_policy=INPUTS + TASK_SOURCE, persist_result=True)
def composition_request(prompt: str, directory: Path, session: str, model: str) -> str:
    store = Store(directory)
    if len(prompt.encode()) > 48000:
        raise ValueError("Music context exceeds 48 KB")
    store.call(session)
    with tempfile.TemporaryDirectory() as scratch:
        pi = Path(scratch) / ".pi"
        pi.mkdir()
        (pi / "settings.json").write_text(
            json.dumps(
                {
                    "retry": {
                        "enabled": False,
                        "maxRetries": 0,
                        "provider": {"maxRetries": 0},
                    }
                }
            )
        )
        result = subprocess.run(
            [
                "pi",
                "--model",
                model,
                "--thinking",
                "low",
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
            ],
            cwd=scratch,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=120,
            env={
                key: os.environ[key]
                for key in ("HOME", "PATH", "LANG")
                if key in os.environ
            },
            check=True,
        )
    messages = [
        e["message"]
        for line in result.stdout.splitlines()
        if line.strip()
        if (e := json.loads(line)).get("type") == "message_end"
        and e.get("message", {}).get("role") == "assistant"
    ]
    for message in messages:
        store.charge(session, message["usage"]["cost"]["total"])
    if len(messages) != 1:
        raise ValueError("Expected one composition response")
    source = "".join(
        p["text"] for p in messages[0]["content"] if p["type"] == "text"
    ).strip()
    return source


def parse_composition(source: str) -> Composition:
    tree = ast.parse(source)
    values = {}
    fields = {
        "TITLE": "title",
        "IDEA": "idea",
        "MEMORY": "memory",
        "PEER_NOTE": "peer_note",
        "KEEP_PEER": "keep_peer",
        "TASTE": "taste",
        "INSPIRATIONS": "inspirations",
    }
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in fields:
                    values[fields[target.id]] = ast.literal_eval(node.value)
    return Composition(python=source, **values)


def render(code: str, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    container = "plyr-composition-" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory() as scratch:
        fresh = Path(scratch) / "output"
        fresh.mkdir(mode=0o777)
        fresh.chmod(0o777)
        source = Path(scratch) / "compose.py"
        source.write_text(code)
        source.chmod(0o644)
        command = [
            "docker",
            "run",
            "--name",
            container,
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--cpus",
            "1",
            "--memory",
            "512m",
            "--memory-swap",
            "512m",
            "--pids-limit",
            "32",
            "--ulimit",
            "fsize=4194304:4194304",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            "-e",
            "OPENBLAS_NUM_THREADS=1",
            "-e",
            "OMP_NUM_THREADS=1",
            "-v",
            f"{source.resolve()}:/input/compose.py:ro",
            "-v",
            f"{fresh.resolve()}:/output",
            "-v",
            f"{ROOT / 'studio_instruments.py'}:/usr/local/lib/python3.13/site-packages/studio_instruments.py:ro",
            "plyr-musician-python:local",
        ]
        try:
            subprocess.run(
                command,
                timeout=30,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        finally:
            subprocess.run(
                ["docker", "rm", "-f", container],
                capture_output=True,
                timeout=15,
                check=False,
            )
        path = fresh / "track.wav"
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 4_000_000:
            raise ValueError("Invalid audio output")
        if (output / "track.wav").is_symlink():
            raise ValueError("Output destination must not be a symlink")
        shutil.copyfile(path, output / "track.wav")
    path = output / "track.wav"
    if path.is_symlink() or path.stat().st_size > 4_000_000:
        raise ValueError("Invalid audio output")
    with wave.open(str(path), "rb") as audio:
        if (
            audio.getnchannels(),
            audio.getsampwidth(),
            audio.getframerate(),
            audio.getnframes(),
        ) != (2, 2, 44100, 441000):
            raise ValueError("Expected ten-second stereo 44100 Hz 16-bit WAV")
        samples = (
            np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(
                float
            )
            / 32768
        )
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples**2)))
    if rms < 0.001 or peak >= 0.999:
        raise ValueError("Silent or clipped audio")
    return {"duration": 10, "peak": peak, "rms": rms}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("musician", choices=["moss", "kite", "reed"])
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    root = ROOT / "state"
    store = Store(root)
    now = datetime.now(UTC)
    session = store.reserve(now, retry_failed=args.retry_failed)
    if session is None:
        raise SystemExit("Session slot or budget unavailable")
    profile = Musician.model_validate(
        json.loads((ROOT / "profiles" / f"{args.musician}.json").read_text())["profile"]
    )
    previous = store.history(args.musician, session)
    try:
        composition = compose(
            profile, previous, store, session, musician_id=args.musician
        )
        directory = root / f"{session}-{args.musician}"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "composition.json").write_text(
            composition.model_dump_json(indent=2)
        )
        metrics = render(composition.python, directory / "audio")
        store.save_study(
            session,
            args.musician,
            {**composition.model_dump(), "rendered": True, "metrics": metrics},
        )
        store.finish(session, "completed")
        print(
            json.dumps(
                {
                    "title": composition.title,
                    "audio": str((directory / "audio/track.wav").resolve()),
                    "metrics": metrics,
                    "usage": store.usage(now),
                }
            )
        )
    except BaseException:
        store.finish(session, "failed")
        raise


if __name__ == "__main__":
    main()

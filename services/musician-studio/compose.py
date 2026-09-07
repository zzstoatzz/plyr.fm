"""Compose Python music locally and render it in an isolated container."""

import argparse
import ast
import json
import os
import subprocess
import tempfile
import uuid
import wave
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field

from studio.identity import Musician
from studio.state import Store

ROOT = Path(__file__).parent


class Composition(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    idea: str = Field(min_length=1, max_length=1500)
    python: str = Field(min_length=1, max_length=40000)


def compose(
    profile: Musician, previous: list[dict], store: Store, session: str
) -> Composition:
    prompt = (
        "Make a ten-second piece of music as this musician. Use Python and numpy to create the audio. "
        "You control the instruments, synthesis, musical structure, rhythm, harmony, and mix. "
        "Write a complete executable script using only numpy and the Python standard library. "
        "It must write /output/track.wav as ten seconds of 16-bit PCM stereo at 44100 Hz. "
        "The environment has no network or external files; runtime is limited to 30 seconds and 512 MB. "
        "Avoid clipping. Choose a title for this particular composition. "
        "Identity and inspirations: "
        + profile.model_dump_json()
        + "\nYour earlier work (code and intentions, not an audio listening experience): "
        + json.dumps(previous)
        + "\nReturn only executable Python source, no JSON or markdown. Include TITLE and IDEA as string constants."
    )
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
                "openai-codex/gpt-5.6-luna",
                "--thinking",
                "off",
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
    if source.startswith("```python\n") and source.endswith("```"):
        source = source[len("```python\n") : -3].strip()
    store.save_study(session, profile.name.lower(), {"source": source})
    tree = ast.parse(source)
    strings = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in ("TITLE", "IDEA"):
                    strings[target.id] = node.value.value
    answer = Composition(title=strings["TITLE"], idea=strings["IDEA"], python=source)
    return answer


def render(code: str, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o777)
    container = "plyr-composition-" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory() as scratch:
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
            f"{output.resolve()}:/output",
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
    previous = []
    with store.connect() as db:
        for (body,) in db.execute(
            "SELECT body FROM studies WHERE musician=? ORDER BY session DESC LIMIT 3",
            (args.musician,),
        ):
            previous.append(json.loads(body))
    try:
        composition = compose(profile, previous, store, session)
        directory = root / f"{session}-{args.musician}"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "composition.json").write_text(
            composition.model_dump_json(indent=2)
        )
        metrics = render(composition.python, directory / "audio")
        store.save_study(session, args.musician, composition.model_dump())
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

"""A worker's open stdin must not prevent Pi from sending its prompt."""

import json
import os
import subprocess
import sys
from pathlib import Path

from studio.models import Decision


def test_pi_does_not_inherit_workers_open_stdin(tmp_path: Path) -> None:
    taste = {
        name: 0.5
        for name in (
            "harmonic_motion",
            "rhythmic_complexity",
            "density",
            "brightness",
            "repetition",
            "dissonance",
            "surprise",
        )
    }
    answer = Decision.model_validate(
        {
            "title": "Study",
            "attraction": "A held note.",
            "disagreement": "Too dense.",
            "changed": "Added a rest.",
            "memory": "Leave room.",
            "add_to_playlist": True,
            "taste": taste,
            "score": {
                "attack": 0.1,
                "release": 0.2,
                "lowpass": 1000,
                "events": [{"pitch": "C4", "start": 0, "duration": 1}],
            },
        }
    )
    message = {
        "type": "message_end",
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": answer.model_dump_json()}],
            "usage": {"cost": {"total": 0.001}},
        },
    }
    executable = tmp_path / "pi"
    executable.write_text(
        f"#!{sys.executable}\nimport sys\nsys.stdin.read()\nprint({json.dumps(message)!r})\n"
    )
    executable.chmod(0o755)
    code = """
from pathlib import Path
from datetime import UTC, datetime
from studio.brain import decide
from studio.state import Store
import json, sys
store=Store(Path(sys.argv[1])/'state')
session=store.reserve(datetime.now(UTC))
entry=json.loads(sys.argv[2])
assert decide(store,session,entry,entry).title == 'Study'
"""
    entry = {
        "profile": {
            "name": "Test",
            "ethos": "Rests",
            "likes": ["rests"],
            "dislikes": ["density"],
            "taste": taste,
        },
        "score": {},
    }
    env = {**os.environ, "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"]}
    child = subprocess.Popen(
        [sys.executable, "-c", code, str(tmp_path), json.dumps(entry)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    try:
        assert child.wait(timeout=8) == 0, child.stderr.read().decode()
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate()

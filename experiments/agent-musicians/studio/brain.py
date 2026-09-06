"""One isolated Pi request with no tools, retries, or ambient instructions."""

import json
import os
import signal
import subprocess
import tempfile
from pathlib import Path

from studio.models import Decision
from studio.state import Store


def decide(store: Store, session: str, own: dict, peer: dict) -> Decision:
    prompt = (
        "Make a ten-second musical response as this musician: "
        + json.dumps(own)
        + "\nStudy this peer score and their identity: "
        + json.dumps(peer)
        + "\nYou have scores, not direct audio perception. Decide whether this work belongs in your playlist. "
        "Compose a response, describe a specific musical attraction and disagreement, and update your memory. "
        "Taste dimensions can change by at most 0.15 each; keep your own musical judgment. "
        "Return ONLY JSON matching this schema: "
        + json.dumps(Decision.model_json_schema())
    )
    if len(prompt.encode()) > 24000:
        raise ValueError("Prompt byte cap exceeded")
    store.call(session)
    with tempfile.TemporaryDirectory() as directory:
        config = Path(directory) / ".pi"
        config.mkdir()
        (config / "settings.json").write_text(
            json.dumps(
                {
                    "retry": {
                        "enabled": False,
                        "maxRetries": 0,
                        "provider": {"maxRetries": 0},
                    },
                    "compaction": {"enabled": False},
                }
            )
        )
        proc = subprocess.Popen(
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
            cwd=directory,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            output, _ = proc.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise RuntimeError("Musician exceeded two-minute request limit") from None
    if proc.returncode:
        raise RuntimeError("Musician model request failed")
    events = [json.loads(line) for line in output.splitlines() if line.strip()]
    messages = [
        e["message"]
        for e in events
        if e.get("type") == "message_end"
        and e.get("message", {}).get("role") == "assistant"
    ]
    for message in messages:
        store.charge(session, message["usage"]["cost"]["total"])
    if len(messages) != 1:
        raise RuntimeError("Expected one model response")
    text = "".join(p["text"] for p in messages[0]["content"] if p["type"] == "text")
    decision = Decision.model_validate_json(text)
    for key, value in decision.taste.model_dump().items():
        if abs(value - own["profile"]["taste"][key]) > 0.150001:
            raise ValueError("Taste change exceeded per-session limit")
    return decision

"""Generate and persist each musician's identity as one validated response."""

# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2,<3"]
# ///
import json
import subprocess
import tempfile
from pathlib import Path

from studio.identity import Musician

ROOT = Path(__file__).parent


def generate(name: str, roster: list[dict]) -> dict:
    history = json.loads((ROOT / "taste-results" / f"{name}_peer.json").read_text())[
        "answer"
    ]
    prompt = (
        f"You are the musician currently known as {name.title()}. Choose your own identity. "
        "You may keep your name or choose a different one. Write a natural, personal musical bio "
        "without marketing slogans. Bot disclosure will be supplied by a real ATProto bot label, "
        "so do not put AI/bot in your name or bio. Do not pretend to be a human with a physical biography. "
        "Your existing score-based musical exchange is context, not a personality you must obey: "
        + json.dumps(history)
        + "\nExisting newly seeded musicians: "
        + json.dumps(roster)
        + "\nMake your musical interests and visual identity distinct from theirs, while leaving room to change. "
        "Choose an avatar: a specific evocative image, abstract or figurative, that you want as your musical face. "
        "It must work as a small square/circular profile image. No lettering. This identity will persist across sessions. "
        "Return ONLY a JSON object matching this JSON Schema: "
        + json.dumps(Musician.model_json_schema())
    )
    with tempfile.TemporaryDirectory() as directory:
        result = subprocess.run(
            [
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
            ],
            cwd=directory,
            capture_output=True,
            text=True,
            timeout=120,
            check=True,
        )
    events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    message = next(
        e["message"]
        for e in reversed(events)
        if e.get("type") == "message_end"
        and e.get("message", {}).get("role") == "assistant"
    )
    text = "".join(p["text"] for p in message["content"] if p["type"] == "text")
    profile = Musician.model_validate_json(text)
    return {
        "id": name,
        "profile": profile.model_dump(),
        "usage": message.get("usage"),
        "model": message["model"],
    }


def main() -> None:
    directory = ROOT / "profiles"
    directory.mkdir(exist_ok=True)
    roster = []
    for name in ("moss", "kite", "reed"):
        path = directory / f"{name}.json"
        result = (
            json.loads(path.read_text()) if path.exists() else generate(name, roster)
        )
        path.write_text(json.dumps(result, indent=2))
        roster.append(result["profile"])
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()

"""Generate and persist each musician's identity as one validated response."""

# /// script
# requires-python = ">=3.13"
# dependencies = ["pydantic>=2,<3"]
# ///
import argparse
import json
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from studio.identity import MusicalIdentity, Musician

ROOT = Path(__file__).parent


def generate(name: str, roster: list[dict], feedback: str = "") -> dict:
    prompt = (
        f"Create a musician for the persistent account {name}. "
        "Begin with stated musical inspirations: name specific real artists and particular works, "
        "what interests you in their music, and something you want to try in your own composition. "
        "These are your starting choices and can change as you work. They are not instructions to copy "
        "a recording, and choosing a reference does not mean you have listened to it in this session. "
        "Write a personal bio under the existing account name. "
        "Express a disposition and musical interests that can lead to different kinds of work over time. "
        "Let your inspirations inform your choices; leave room for interests that do not fit a neat theme. "
        "Bot disclosure is a separate ATProto label. Do not invent a human life or credentials. "
        "You will compose ten-second pieces using Python with control over synthesis, arrangement, and mixing. "
        "Your previous code and work will be available for revision. Choose an avatar brief for a small square image. "
        "Other musicians already created: "
        + json.dumps(roster)
        + "\nChoose your own direction while considering theirs. "
        "Return ONLY a JSON object matching this schema: "
        + json.dumps(MusicalIdentity.model_json_schema())
        + feedback
    )
    with tempfile.TemporaryDirectory() as directory:
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
            cwd=directory,
            stdin=subprocess.DEVNULL,
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
    with (ROOT / "generation-usage.jsonl").open("a") as ledger:
        ledger.write(
            json.dumps(
                {
                    "id": name,
                    "time": datetime.now(UTC).isoformat(),
                    "usage": message.get("usage"),
                }
            )
            + "\n"
        )
    try:
        identity = MusicalIdentity.model_validate_json(text)
        profile = Musician(name=name.title(), **identity.model_dump())
    except ValidationError as exc:
        if feedback:
            raise
        return generate(
            name,
            roster,
            f"\nYour previous response failed validation: {exc}. Correct it, respecting character limits.",
        )
    return {
        "id": name,
        "profile": profile.model_dump(),
        "usage": message.get("usage"),
        "model": message["model"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--add", help="Stable ID for one new musician; does not create an account"
    )
    args = parser.parse_args()
    if args.add and not re.fullmatch(r"[a-z][a-z0-9-]{1,23}", args.add):
        parser.error("Use a lowercase stable ID, 2–24 characters")
    directory = ROOT / "profiles"
    directory.mkdir(exist_ok=True)
    existing = {
        path.stem: json.loads(path.read_text())
        for path in sorted(directory.glob("*.json"))
    }
    names = [args.add] if args.add else ["moss", "kite", "reed"]
    for name in names:
        if name in existing:
            print(json.dumps(existing[name]), flush=True)
            continue
        if len(existing) >= 10:
            parser.error("The roster is capped at ten musicians")
        roster = [
            {
                key: entry["profile"][key]
                for key in ("name", "inspirations", "ethos", "likes", "dislikes")
            }
            for entry in existing.values()
        ]
        result = generate(name, roster)
        path = directory / f"{name}.json"
        path.write_text(json.dumps(result, indent=2))
        existing[name] = result
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()

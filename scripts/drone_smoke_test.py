#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.11"
# dependencies = ["plyrfm", "python-dotenv"]
# ///
"""12-chromatic-drone concurrent upload smoke test.

fires 12 concurrent uploads (one per semitone) all targeting the same album
"chromatic drones". reproduces the scenario that produced 2/12
MissingGreenlet failures on stg before #1334.

usage:
    uv run scripts/drone_smoke_test.py                    # stg (default)
    uv run scripts/drone_smoke_test.py --env prod         # prod

reads .env at repo root:
    PLYR_STG_TOKEN_MAIN  — stg token (primary account)
    PLYR_TOKEN           — prod token

drones expected at /tmp/chromatic_drone/drone_{C4,Cs4,D4,Ds4,E4,F4,Fs4,G4,Gs4,A4,As4,B4}.wav
"""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from plyrfm import AsyncPlyrClient

DRONE_DIR = Path("/tmp/chromatic_drone")
NOTES = ["C4", "Cs4", "D4", "Ds4", "E4", "F4", "Fs4", "G4", "Gs4", "A4", "As4", "B4"]
ALBUM = "chromatic drones"


async def upload_one(
    client: AsyncPlyrClient, note: str
) -> tuple[str, bool, float, str]:
    file = DRONE_DIR / f"drone_{note}.wav"
    start = time.perf_counter()
    try:
        result = await client.tracks.upload(
            file=file,
            title=f"drone {note}",
            album=ALBUM,
            tags={"smoke-test", "drone", "chromatic"},
            timeout=300.0,
        )
        return note, True, time.perf_counter() - start, f"track_id={result.track_id}"
    except Exception as e:
        return note, False, time.perf_counter() - start, f"{type(e).__name__}: {e}"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", choices=["stg", "prod"], default="stg")
    args = parser.parse_args()

    repo_root = Path(__file__).parent.parent
    load_dotenv(repo_root / ".env")

    if args.env == "stg":
        token = os.environ.get("PLYR_STG_TOKEN_MAIN")
        api_url = "https://api-stg.plyr.fm"
    else:
        token = os.environ.get("PLYR_TOKEN")
        api_url = "https://api.plyr.fm"

    if not token:
        print(f"error: token for {args.env} not set in .env", file=sys.stderr)
        return 2

    missing = [n for n in NOTES if not (DRONE_DIR / f"drone_{n}.wav").exists()]
    if missing:
        print(f"error: missing drone files: {missing}", file=sys.stderr)
        return 2

    print(f"target: {api_url}")
    print(f"firing {len(NOTES)} concurrent uploads to album {ALBUM!r}\n")

    wall_start = time.perf_counter()
    async with AsyncPlyrClient(token=token, api_url=api_url) as client:
        results = await asyncio.gather(*(upload_one(client, note) for note in NOTES))
    wall = time.perf_counter() - wall_start

    successes = [r for r in results if r[1]]
    failures = [r for r in results if not r[1]]

    print("results:")
    for note, ok, elapsed, detail in sorted(results, key=lambda r: r[0]):
        marker = "OK " if ok else "ERR"
        print(f"  [{marker}] {note:4s} {elapsed:6.2f}s  {detail}")

    print(f"\nsummary: {len(successes)}/{len(NOTES)} succeeded, wall={wall:.2f}s")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

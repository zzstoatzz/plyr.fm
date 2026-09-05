"""Guard the API contract consumed by the SDK, CLI and MCP without service I/O."""

import argparse
import json
from pathlib import Path

from fastapi import FastAPI

from backend.api import (
    artists_router,
    audio_router,
    auth_router,
    search_router,
    tracks_router,
)
from backend.api.lists import router as lists_router

ROOT = Path(__file__).resolve().parents[1]


def structural(value: object) -> object:
    if isinstance(value, list):
        return [structural(item) for item in value]
    if isinstance(value, dict):
        return {
            key: structural(item)
            for key, item in value.items()
            if key not in {"description", "title", "examples", "example", "operationId"}
        }
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path)
    args = parser.parse_args()
    app = FastAPI()
    for router in [
        tracks_router,
        search_router,
        artists_router,
        auth_router,
        audio_router,
        lists_router,
    ]:
        app.include_router(router)
    current = app.openapi()
    if args.export:
        args.export.write_text(json.dumps(current, indent=2) + "\n")
    baseline = json.loads(
        (ROOT / "docs/internal/contracts/client-api.json").read_text()
    )
    errors: list[str] = []
    for path, expected in baseline["paths"].items():
        if structural(current["paths"].get(path)) != structural(expected):
            errors.append(f"HTTP contract changed: {path}")
    for name, expected in baseline["components"]["schemas"].items():
        if structural(current["components"]["schemas"].get(name)) != structural(
            expected
        ):
            errors.append(f"Response/input schema changed: {name}")
    if errors:
        raise SystemExit(
            "\n".join(errors)
            + "\nUpdate and verify the matching SDK/MCP contract before merging. See docs/internal/contracts/README.md."
        )
    print("Client API contract matches the current backend")


if __name__ == "__main__":
    main()

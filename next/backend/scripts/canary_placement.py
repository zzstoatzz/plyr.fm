"""Keep Next's single stateless API Machine near its us-west-2 database."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

APP = "plyr-api-zig-canary"
REGION = "sea"
Runner = Callable[[list[str]], str]


class PlacementError(RuntimeError):
    """The current Machine topology cannot be changed safely."""


@dataclass(frozen=True)
class Machine:
    id: str
    name: str
    region: str
    state: str
    ready: bool
    configuration: str


def _system_run(arguments: list[str]) -> str:
    result = subprocess.run(
        arguments,
        check=True,
        text=True,
        capture_output=True,
        timeout=180 if arguments[1:3] == ["machine", "clone"] else 30,
    )
    return result.stdout


def _ready(machine: dict[str, Any]) -> bool:
    checks = machine.get("checks")
    if not isinstance(checks, list) or not checks:
        return False
    if any(check.get("status") != "passing" for check in checks):
        return False
    for check in checks:
        try:
            output = json.loads(check.get("output", ""))
        except (ValueError, TypeError):
            continue
        if isinstance(output, dict) and output == {
            "status": "ready",
            "index": "reachable",
        }:
            return machine.get("state") == "started"
    return False


def _api_machines(runner: Runner) -> list[Machine]:
    inventory = json.loads(
        runner(["flyctl", "machines", "list", "--app", APP, "--json"])
    )
    if not isinstance(inventory, list):
        raise PlacementError("Machine inventory must be an array")
    machines: list[Machine] = []
    for item in inventory:
        if not isinstance(item, dict) or not isinstance(item.get("config"), dict):
            raise PlacementError("Machine inventory contains malformed configuration")
        config = item["config"]
        group = config.get("metadata", {}).get("fly_process_group")
        if group != "app":
            if config.get("services"):
                raise PlacementError("unexpected non-API Machine has public services")
            continue
        if config.get("env", {}).get("FLY_PROCESS_GROUP") != "app":
            raise PlacementError("API process-group metadata disagrees")
        if config.get("mounts"):
            raise PlacementError("refusing to relocate an API Machine with a volume")
        if not config.get("services"):
            raise PlacementError("API Machine has no service configuration")
        if any(
            not isinstance(item.get(key), str) or not item[key]
            for key in ("id", "name", "region", "state")
        ):
            raise PlacementError("API Machine identity is incomplete")
        machines.append(
            Machine(
                item["id"],
                item["name"],
                item["region"],
                item["state"],
                _ready(item),
                hashlib.sha256(
                    json.dumps(
                        {
                            key: config.get(key)
                            for key in (
                                "image",
                                "env",
                                "services",
                                "guest",
                                "init",
                                "restart",
                            )
                        },
                        sort_keys=True,
                    ).encode()
                ).hexdigest(),
            )
        )
    return machines


def _pair(
    machines: list[Machine], source: Machine, name: str, *, verify_target: bool = True
) -> Machine:
    originals = [machine for machine in machines if machine.id == source.id]
    targets = [machine for machine in machines if machine.name == name]
    if len(machines) != 2 or len(originals) != 1 or len(targets) != 1:
        raise PlacementError("expected only the original API and its exact replacement")
    target = targets[0]
    if (
        originals[0].region != source.region
        or target.id == source.id
        or target.region != REGION
    ):
        raise PlacementError("API replacement identity or region changed")
    if originals[0].configuration != source.configuration or (
        verify_target and target.configuration != source.configuration
    ):
        raise PlacementError(
            "replacement must preserve the deployed image and runtime configuration"
        )
    return target


def _rollback(runner: Runner, source: Machine, name: str) -> None:
    machines = _api_machines(runner)
    candidates = [machine for machine in machines if machine.name == name]
    if not candidates:
        return
    target = _pair(machines, source, name, verify_target=False)
    runner(["flyctl", "machine", "destroy", target.id, "--app", APP, "--force"])
    print("removed failed replacement; original API retained")


def ensure_next_api(
    name: str,
    runner: Runner = _system_run,
    *,
    now: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    health_timeout: float = 90,
) -> None:
    if not re.fullmatch(r"next-api-sea-[0-9]+-[0-9]+", name):
        raise PlacementError("replacement name must identify the CI run")
    machines = _api_machines(runner)
    if len(machines) != 1:
        raise PlacementError("expected exactly one API Machine before relocation")
    source = machines[0]
    if source.region == REGION:
        print(f"Next API already in {REGION}; no Machine changes")
        return
    if source.name == name:
        raise PlacementError("replacement name already belongs to the source")
    print(f"Cloning API {source.id} from {source.region} to {REGION}")
    try:
        runner(
            [
                "flyctl",
                "machine",
                "clone",
                source.id,
                "--app",
                APP,
                "--region",
                REGION,
                "--name",
                name,
            ]
        )
        deadline = now() + health_timeout
        while True:
            target = _pair(_api_machines(runner), source, name)
            if target.ready:
                break
            if now() >= deadline:
                raise PlacementError(
                    "replacement did not pass its own database readiness check"
                )
            sleep(2)
    except Exception:
        _rollback(runner, source, name)
        raise

    target = _pair(_api_machines(runner), source, name)
    if not target.ready:
        _rollback(runner, source, name)
        raise PlacementError("replacement lost readiness before retirement")
    print(f"Replacement API {target.id} is ready; retiring {source.id}")
    runner(["flyctl", "machine", "destroy", source.id, "--app", APP, "--force"])
    remaining = _api_machines(runner)
    if (
        len(remaining) != 1
        or remaining[0].id != target.id
        or remaining[0].region != REGION
    ):
        raise PlacementError("retirement did not leave exactly the replacement API")
    print(f"Next API relocated to {REGION}; one API Machine remains")


def main() -> None:
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("GITHUB_REPOSITORY") != "zzstoatzz/plyr.fm"
        or os.environ.get("GITHUB_REF") != "refs/heads/main"
    ):
        raise PlacementError(
            "API relocation runs only in this repository's main-branch CI"
        )
    ensure_next_api(
        f"next-api-sea-{os.environ.get('GITHUB_RUN_ID', '')}-{os.environ.get('GITHUB_RUN_ATTEMPT', '')}"
    )


if __name__ == "__main__":
    main()

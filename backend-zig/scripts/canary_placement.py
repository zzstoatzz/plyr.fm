"""Health-gated Fly Machine placement for the isolated Zig canary."""

from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Runner = Callable[[list[str], bool], str]


class PlacementError(RuntimeError):
    """The current Machine topology cannot be changed safely."""


@dataclass(frozen=True)
class Machine:
    id: str
    region: str


@dataclass(frozen=True)
class PlacementPlan:
    target: Machine | None
    source: Machine
    old: tuple[Machine, ...]


def _system_run(args: list[str], capture: bool) -> str:
    completed = subprocess.run(
        args,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return completed.stdout or ""


def _service_machines(payload: str) -> tuple[Machine, ...]:
    value: Any = json.loads(payload)
    if not isinstance(value, list):
        raise PlacementError("flyctl Machine inventory must be a JSON array")
    machines: list[Machine] = []
    for item in value:
        if not isinstance(item, dict):
            raise PlacementError("flyctl Machine inventory contains a non-object")
        config = item.get("config")
        if not isinstance(config, dict):
            raise PlacementError("Fly Machine is missing config")
        services = config.get("services")
        if not isinstance(services, list):
            raise PlacementError("Fly Machine services must be an array")
        if not services:
            continue
        machine_id = item.get("id")
        region = item.get("region")
        if not isinstance(machine_id, str) or not machine_id:
            raise PlacementError("service Machine has no canonical ID")
        if not isinstance(region, str) or not region:
            raise PlacementError("service Machine has no region")
        machines.append(Machine(id=machine_id, region=region))
    return tuple(machines)


def _plan(machines: Sequence[Machine], target_region: str) -> PlacementPlan:
    targets = tuple(machine for machine in machines if machine.region == target_region)
    if len(targets) > 1:
        raise PlacementError(
            f"expected at most one service Machine in {target_region}, found {len(targets)}"
        )
    if not machines:
        raise PlacementError("no service Machine is available to clone")
    target = targets[0] if targets else None
    source = target or machines[0]
    old = tuple(machine for machine in machines if machine.region != target_region)
    return PlacementPlan(target=target, source=source, old=old)


def _list_machines(app: str, runner: Runner) -> tuple[Machine, ...]:
    return _service_machines(
        runner(["flyctl", "machines", "list", "--app", app, "--json"], True)
    )


def prepare(
    app: str,
    target_region: str,
    github_output: Path,
    runner: Runner = _system_run,
) -> PlacementPlan:
    plan = _plan(_list_machines(app, runner), target_region)
    if plan.target is None:
        runner(
            [
                "flyctl",
                "machine",
                "clone",
                plan.source.id,
                "--app",
                app,
                "--region",
                target_region,
            ],
            False,
        )
        plan = _plan(_list_machines(app, runner), target_region)
        if plan.target is None:
            raise PlacementError("clone completed without a target-region Machine")

    for machine in plan.old:
        runner(["flyctl", "machine", "cordon", machine.id, "--app", app], False)
    with github_output.open("a") as output:
        output.write(f"target_id={plan.target.id}\n")
        output.write(f"old_ids={' '.join(machine.id for machine in plan.old)}\n")
    return plan


def restore(app: str, machine_ids: Sequence[str], runner: Runner = _system_run) -> None:
    for machine_id in machine_ids:
        runner(["flyctl", "machine", "uncordon", machine_id, "--app", app], False)


def complete(
    app: str, machine_ids: Sequence[str], runner: Runner = _system_run
) -> None:
    for machine_id in machine_ids:
        runner(
            ["flyctl", "machine", "destroy", machine_id, "--app", app, "--force"],
            False,
        )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--app", required=True)
    prepare_parser.add_argument("--target-region", required=True)
    prepare_parser.add_argument("--github-output", type=Path, required=True)
    for command in ("restore", "complete"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("--app", required=True)
        command_parser.add_argument("machine_ids", nargs="*")
    return parser


def main() -> None:
    args = _parser().parse_args()
    if args.command == "prepare":
        prepare(args.app, args.target_region, args.github_output)
    elif args.command == "restore":
        restore(args.app, args.machine_ids)
    else:
        complete(args.app, args.machine_ids)


if __name__ == "__main__":
    main()

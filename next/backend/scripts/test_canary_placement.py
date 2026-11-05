from __future__ import annotations

import json
import subprocess
from copy import deepcopy
from unittest.mock import patch

import pytest
from canary_placement import (
    APP,
    CONFIG,
    PlacementError,
    _system_run,
    ensure_next_api,
    main,
)

NAME = "next-api-sjc-123-1"


def _machine(
    machine_id: str,
    region: str,
    *,
    group: str = "app",
    ready: bool = True,
    name: str | None = None,
) -> dict[str, object]:
    return {
        "id": machine_id,
        "name": name or machine_id,
        "region": region,
        "state": "started",
        "image_ref": {"digest": "sha256:" + "a" * 64},
        "config": {
            "metadata": {"fly_process_group": group},
            "env": {"FLY_PROCESS_GROUP": group, "PRIMARY_REGION": "sjc"},
            "image": "registry.fly.io/plyr-api-zig-canary:deployed-sha",
            "services": [{"internal_port": 8000}] if group == "app" else [],
            "mounts": [],
            "guest": {"cpu_kind": "shared", "cpus": 1, "memory_mb": 256},
        },
        "checks": [
            {
                "status": "passing" if ready else "critical",
                "output": '{"status":"ready","index":"reachable"}',
            }
        ],
    }


OLD = _machine("old", "iad")
NEW = _machine("new", "sjc", name=NAME)
INGESTER = _machine("ingester", "sjc", group="ingester")


class FakeRunner:
    def __init__(self, *, failure: str | None = None) -> None:
        self.machines = deepcopy([OLD, INGESTER])
        self.calls: list[list[str]] = []
        self.failure = failure
        self.clone_ready = failure != "unhealthy"
        self.target_checks = 0
        self.regions = [{"code": "sjc", "deprecated": False, "capacity": 1}]

    def __call__(self, arguments: list[str]) -> str:
        self.calls.append(arguments)
        assert arguments[0] == "flyctl"
        if arguments[1:3] == ["platform", "regions"]:
            assert arguments == ["flyctl", "platform", "regions", "--json"]
            return json.dumps(self.regions)
        assert APP in arguments
        command = arguments[1:3]
        if command == ["machines", "list"]:
            if any(machine["id"] == "new" for machine in self.machines):
                self.target_checks += 1
                if self.failure == "flap" and self.target_checks >= 2:
                    self.machines[-1]["checks"][0]["status"] = "critical"
            return json.dumps(self.machines)
        if command == ["machine", "clone"]:
            assert arguments[3] == "old"
            assert arguments[-6:-4] == ["--config", str(CONFIG)]
            assert arguments[-4:] == ["--region", "sjc", "--name", NAME]
            clone = deepcopy(NEW)
            if not self.clone_ready:
                clone["checks"][0]["status"] = "critical"
            self.machines.append(clone)
            if self.failure == "clone":
                raise RuntimeError("clone failed after allocation")
        elif command == ["machine", "destroy"]:
            machine_id = arguments[3]
            assert machine_id in {"old", "new"}
            if machine_id == "old":
                clone = next(
                    machine for machine in self.machines if machine["id"] == "new"
                )
                assert clone["checks"][0]["status"] == "passing"
                if self.failure == "retire":
                    raise RuntimeError("old retirement failed")
            self.machines = [
                machine for machine in self.machines if machine["id"] != machine_id
            ]
            if self.failure == "retire-after" and machine_id == "old":
                raise RuntimeError("retirement response lost")
        else:
            raise AssertionError(arguments)
        return ""


def test_move_preserves_ingester_and_removes_only_old_after_target_ready() -> None:
    runner = FakeRunner()
    ensure_next_api(NAME, runner)
    assert runner.machines == [INGESTER, NEW]
    assert (
        len([call for call in runner.calls if call[1:3] == ["machine", "clone"]]) == 1
    )
    assert [
        call[3] for call in runner.calls if call[1:3] == ["machine", "destroy"]
    ] == ["old"]
    assert all("ingester" not in call for call in runner.calls)


def test_already_placed_is_a_read_only_noop() -> None:
    runner = FakeRunner()
    runner.machines = deepcopy([NEW, INGESTER])
    ensure_next_api(NAME, runner)
    assert len(runner.calls) == 1


@pytest.mark.parametrize("failure", ["unhealthy", "clone", "flap"])
def test_failed_replacement_is_removed_with_original_retained(failure: str) -> None:
    runner = FakeRunner(failure=failure)
    with pytest.raises((RuntimeError, PlacementError)):
        ensure_next_api(NAME, runner, health_timeout=0)
    assert runner.machines == [OLD, INGESTER]
    assert [
        call[3] for call in runner.calls if call[1:3] == ["machine", "destroy"]
    ] == ["new"]


def test_failed_retirement_keeps_healthy_replacement_for_recovery() -> None:
    runner = FakeRunner(failure="retire")
    with pytest.raises(RuntimeError, match="retirement"):
        ensure_next_api(NAME, runner)
    assert runner.machines == [OLD, INGESTER, NEW]
    assert [
        call[3] for call in runner.calls if call[1:3] == ["machine", "destroy"]
    ] == ["old"]


@pytest.mark.parametrize(
    "case", ["multiple", "volume", "metadata", "no-service", "malformed"]
)
def test_unsafe_topology_is_rejected_before_any_mutation(case: str) -> None:
    runner = FakeRunner()
    if case == "multiple":
        runner.machines.append(deepcopy(NEW))
    elif case == "volume":
        runner.machines[0]["config"]["mounts"] = [{"volume": "stateful"}]
    elif case == "metadata":
        runner.machines[0]["config"]["env"]["FLY_PROCESS_GROUP"] = "ingester"
    elif case == "no-service":
        runner.machines[0]["config"]["services"] = []
    else:
        runner.machines[0]["config"] = None
    with pytest.raises(PlacementError):
        ensure_next_api(NAME, runner)
    assert len(runner.calls) == 1


def test_changed_clone_image_is_never_allowed_to_retire_original() -> None:
    runner = FakeRunner()
    original_run = runner.__call__

    def run(arguments: list[str]) -> str:
        result = original_run(arguments)
        if arguments[1:3] == ["machine", "clone"]:
            runner.machines[-1]["config"]["image"] = "unexpected:image"
        return result

    with pytest.raises(PlacementError, match="preserve"):
        ensure_next_api(NAME, run)
    assert [
        call[3] for call in runner.calls if call[1:3] == ["machine", "destroy"]
    ] == ["new"]
    assert runner.machines == [OLD, INGESTER]


@pytest.mark.parametrize(
    "changed",
    [
        {"GITHUB_ACTIONS": "false"},
        {"GITHUB_REPOSITORY": "another/repo"},
        {"GITHUB_REF": "refs/heads/feature"},
    ],
)
def test_main_refuses_local_or_wrong_repository_execution(
    changed: dict[str, str],
) -> None:
    environment = {
        "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": "zzstoatzz/plyr.fm",
        "GITHUB_REF": "refs/heads/main",
        **changed,
    }
    with (
        patch.dict("os.environ", environment, clear=True),
        pytest.raises(PlacementError, match="main-branch CI"),
    ):
        main()


def test_retirement_response_loss_never_removes_healthy_replacement() -> None:
    runner = FakeRunner(failure="retire-after")
    with pytest.raises(RuntimeError, match="response lost"):
        ensure_next_api(NAME, runner)
    assert runner.machines == [INGESTER, NEW]
    assert [
        call[3] for call in runner.calls if call[1:3] == ["machine", "destroy"]
    ] == ["old"]


@pytest.mark.parametrize("failure", ["exit", "timeout"])
def test_cli_errors_preserve_provider_reason_without_exposing_token(
    failure: str,
) -> None:
    token = "FlyV1 fixture-secret-token"
    stderr = (
        f"Error: permission denied; authorization {token}; raw fixture-secret-token"
    )
    error = (
        subprocess.CalledProcessError(1, ["flyctl"], stderr=stderr)
        if failure == "exit"
        else subprocess.TimeoutExpired(["flyctl"], 30, stderr=stderr.encode())
    )
    with (
        patch.dict("os.environ", {"FLY_API_TOKEN": token}),
        patch("canary_placement.subprocess.run", side_effect=error),
        pytest.raises(PlacementError, match="permission denied") as raised,
    ):
        _system_run(["flyctl", "machine", "clone"])
    assert "fixture-secret-token" not in str(raised.value)
    assert "[redacted]" in str(raised.value)


def test_clone_digest_pin_preserves_the_deployed_image_identity() -> None:
    runner = FakeRunner()
    original_run = runner.__call__

    def run(arguments: list[str]) -> str:
        result = original_run(arguments)
        if arguments[1:3] == ["machine", "clone"]:
            runner.machines[-1]["config"]["image"] += "@sha256:" + "a" * 64
        return result

    ensure_next_api(NAME, run)
    assert [machine["id"] for machine in runner.machines] == ["ingester", "new"]


def test_wrong_clone_digest_cannot_retire_original() -> None:
    runner = FakeRunner()
    original_run = runner.__call__

    def run(arguments: list[str]) -> str:
        result = original_run(arguments)
        if arguments[1:3] == ["machine", "clone"]:
            runner.machines[-1]["image_ref"]["digest"] = "sha256:" + "b" * 64
        return result

    with pytest.raises(PlacementError, match="digest"):
        ensure_next_api(NAME, run)
    assert runner.machines == [OLD, INGESTER]


@pytest.mark.parametrize(
    "regions",
    [
        [],
        [{"code": "sjc", "deprecated": True, "capacity": 1}],
        [{"code": "sjc", "deprecated": False, "capacity": 0}],
    ],
)
def test_region_availability_is_checked_before_cloning(
    regions: list[dict[str, object]],
) -> None:
    runner = FakeRunner()
    runner.regions = regions
    with pytest.raises(PlacementError, match="region sjc"):
        ensure_next_api(NAME, runner)
    assert runner.machines == [OLD, INGESTER]
    assert not [
        call
        for call in runner.calls
        if call[1:3] in (["machine", "clone"], ["machine", "destroy"])
    ]

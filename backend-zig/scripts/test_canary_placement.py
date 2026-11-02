from __future__ import annotations

import json
from pathlib import Path

import pytest
from canary_placement import PlacementError, complete, prepare, restore


class FakeRunner:
    def __init__(self, inventories: list[list[dict[str, object]]]) -> None:
        self.inventories = [json.dumps(inventory) for inventory in inventories]
        self.calls: list[tuple[list[str], bool]] = []

    def __call__(self, args: list[str], capture: bool) -> str:
        self.calls.append((args, capture))
        if capture:
            return self.inventories.pop(0)
        return ""


def _machine(
    machine_id: str, region: str, *, service: bool = True
) -> dict[str, object]:
    return {
        "id": machine_id,
        "region": region,
        "config": {"services": [{"internal_port": 8000}] if service else []},
    }


def test_prepare_clones_before_cordoning_old_machine(tmp_path: Path) -> None:
    runner = FakeRunner(
        [
            [_machine("old", "sjc"), _machine("repair", "iad", service=False)],
            [_machine("old", "sjc"), _machine("new", "iad")],
        ]
    )
    output = tmp_path / "github-output"

    plan = prepare("canary", "iad", output, runner)

    assert plan.target is not None and plan.target.id == "new"
    assert [call[0][1:3] for call in runner.calls] == [
        ["machines", "list"],
        ["machine", "clone"],
        ["machines", "list"],
        ["machine", "cordon"],
    ]
    assert "target_id=new" in output.read_text()
    assert "old_ids=old" in output.read_text()


def test_prepare_is_idempotent_in_target_region(tmp_path: Path) -> None:
    runner = FakeRunner([[_machine("current", "iad")]])
    output = tmp_path / "github-output"

    prepare("canary", "iad", output, runner)

    assert len(runner.calls) == 1
    assert output.read_text() == "target_id=current\nold_ids=\n"


def test_prepare_rejects_ambiguous_target_before_mutation(tmp_path: Path) -> None:
    runner = FakeRunner([[_machine("one", "iad"), _machine("two", "iad")]])

    with pytest.raises(PlacementError, match="at most one"):
        prepare("canary", "iad", tmp_path / "github-output", runner)

    assert len(runner.calls) == 1


def test_restore_and_complete_target_exact_machine_ids() -> None:
    restore_runner = FakeRunner([])
    restore("canary", ["old-one", "old-two"], restore_runner)
    assert [call[0][1:3] for call in restore_runner.calls] == [
        ["machine", "uncordon"],
        ["machine", "uncordon"],
    ]

    complete_runner = FakeRunner([])
    complete("canary", ["old-one"], complete_runner)
    assert complete_runner.calls[0][0] == [
        "flyctl",
        "machine",
        "destroy",
        "old-one",
        "--app",
        "canary",
        "--force",
    ]

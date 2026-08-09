"""Combine deployed load and process snapshots into one enforceable artifact."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

IDLE_RSS_LIMIT_KIB = 16 * 1024
PEAK_RSS_LIMIT_KIB = 64 * 1024


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def build_report(
    idle: dict[str, Any],
    loaded: dict[str, Any],
    benchmarks: list[dict[str, Any]],
) -> dict[str, Any]:
    if idle["pid"] != loaded["pid"]:
        raise ValueError("canary process restarted during measurement")
    if idle["clock_ticks_per_second"] != loaded["clock_ticks_per_second"]:
        raise ValueError("process clock resolution changed during measurement")
    elapsed = loaded["machine_uptime_seconds"] - idle["machine_uptime_seconds"]
    cpu_ticks = loaded["process_cpu_ticks"] - idle["process_cpu_ticks"]
    if elapsed <= 0 or cpu_ticks < 0:
        raise ValueError("resource snapshots are not monotonic")
    for benchmark in benchmarks:
        if benchmark.get("requests", 0) <= 0 or benchmark.get("errors") != 0:
            raise ValueError("every benchmark must complete requests without errors")

    cpu_seconds = cpu_ticks / loaded["clock_ticks_per_second"]
    idle_passed = idle["application_rss_kib"] <= IDLE_RSS_LIMIT_KIB
    peak_passed = loaded["application_peak_rss_kib"] <= PEAK_RSS_LIMIT_KIB
    return {
        "budgets": {
            "idle_application_rss_kib": {
                "limit": IDLE_RSS_LIMIT_KIB,
                "actual": idle["application_rss_kib"],
                "passed": idle_passed,
            },
            "peak_application_rss_kib": {
                "limit": PEAK_RSS_LIMIT_KIB,
                "actual": loaded["application_peak_rss_kib"],
                "passed": peak_passed,
            },
        },
        "observation": {
            "wall_seconds": round(elapsed, 3),
            "application_cpu_seconds": round(cpu_seconds, 3),
            "mean_single_core_cpu_percent": round(cpu_seconds / elapsed * 100, 1),
        },
        "idle": idle,
        "loaded": loaded,
        "benchmarks": benchmarks,
        "passed": idle_passed and peak_passed,
    }


def render_markdown(report: dict[str, Any]) -> str:
    budgets = report["budgets"]
    observation = report["observation"]
    lines = [
        "## Zig canary evidence",
        "",
        "| Gate | Actual | Limit | Result |",
        "| --- | ---: | ---: | :---: |",
    ]
    for name, budget in budgets.items():
        label = name.replace("_", " ")
        result = "pass" if budget["passed"] else "fail"
        lines.append(
            f"| {label} | {budget['actual']} KiB | {budget['limit']} KiB | {result} |"
        )
    lines.extend(
        [
            "",
            f"Observed application CPU: {observation['application_cpu_seconds']}s "
            f"across {observation['wall_seconds']}s "
            f"({observation['mean_single_core_cpu_percent']}% of one core).",
            "",
            "| Path | Concurrency | Requests/s | p50 | p95 | p99 | Errors |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for benchmark in report["benchmarks"]:
        latency = benchmark["latency_ms"]
        lines.append(
            f"| `{benchmark['path']}` | {benchmark['concurrency']} | "
            f"{benchmark['requests_per_second']} | {latency['p50']} ms | "
            f"{latency['p95']} ms | {latency['p99']} ms | "
            f"{benchmark['errors']} |"
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idle", type=Path, required=True)
    parser.add_argument("--loaded", type=Path, required=True)
    parser.add_argument("--benchmark", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    args = parser.parse_args()

    try:
        report = build_report(
            _read_object(args.idle),
            _read_object(args.loaded),
            [_read_object(path) for path in args.benchmark],
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    args.markdown_output.write_text(render_markdown(report))
    if not report["passed"]:
        raise SystemExit("canary exceeded its resource budget")


if __name__ == "__main__":
    main()

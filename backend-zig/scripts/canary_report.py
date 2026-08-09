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
    comparison: dict[str, Any] | None = None,
) -> dict[str, Any]:
    observation = _resource_observation(idle, loaded)
    _validate_benchmarks(benchmarks, require_zero_errors=True)

    idle_passed = idle["application_rss_kib"] <= IDLE_RSS_LIMIT_KIB
    peak_passed = loaded["application_peak_rss_kib"] <= PEAK_RSS_LIMIT_KIB
    report = {
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
        "observation": observation,
        "idle": idle,
        "loaded": loaded,
        "benchmarks": benchmarks,
        "passed": idle_passed and peak_passed,
    }
    if comparison is not None:
        report["comparison"] = _build_comparison(idle, loaded, benchmarks, comparison)
    return report


def _resource_observation(
    idle: dict[str, Any], loaded: dict[str, Any]
) -> dict[str, float]:
    if idle["pid"] != loaded["pid"]:
        raise ValueError("measured process restarted during observation")
    if idle["clock_ticks_per_second"] != loaded["clock_ticks_per_second"]:
        raise ValueError("process clock resolution changed during measurement")
    elapsed = loaded["machine_uptime_seconds"] - idle["machine_uptime_seconds"]
    cpu_ticks = loaded["process_cpu_ticks"] - idle["process_cpu_ticks"]
    if elapsed <= 0 or cpu_ticks < 0:
        raise ValueError("resource snapshots are not monotonic")
    cpu_seconds = cpu_ticks / loaded["clock_ticks_per_second"]
    return {
        "wall_seconds": round(elapsed, 3),
        "application_cpu_seconds": round(cpu_seconds, 3),
        "mean_single_core_cpu_percent": round(cpu_seconds / elapsed * 100, 1),
    }


def _validate_benchmarks(
    benchmarks: list[dict[str, Any]], *, require_zero_errors: bool
) -> None:
    if not benchmarks:
        raise ValueError("at least one benchmark is required")
    for benchmark in benchmarks:
        if benchmark.get("requests", 0) <= 0:
            raise ValueError("every benchmark must complete at least one request")
        if require_zero_errors and benchmark.get("errors") != 0:
            raise ValueError("canary benchmarks must complete without errors")
        if benchmark.get("requests_per_second", 0) <= 0:
            raise ValueError("benchmark throughput must be positive")
        if benchmark.get("mean_response_bytes", 0) <= 0:
            raise ValueError("benchmark responses must have a body")
        if any(
            benchmark.get("latency_ms", {}).get(percentile, 0) <= 0
            for percentile in ("p50", "p95", "p99")
        ):
            raise ValueError("benchmark latency percentiles must be positive")


def _build_comparison(
    idle: dict[str, Any],
    loaded: dict[str, Any],
    benchmarks: list[dict[str, Any]],
    comparison: dict[str, Any],
) -> dict[str, Any]:
    comparison_idle = comparison["idle"]
    comparison_loaded = comparison["loaded"]
    comparison_benchmarks = comparison["benchmarks"]
    comparison_observation = _resource_observation(comparison_idle, comparison_loaded)
    _validate_benchmarks(comparison_benchmarks, require_zero_errors=False)
    by_concurrency = {
        benchmark["concurrency"]: benchmark for benchmark in comparison_benchmarks
    }
    relative_benchmarks = []
    for benchmark in benchmarks:
        baseline = by_concurrency.get(benchmark["concurrency"])
        if baseline is None:
            raise ValueError("comparison is missing a matching concurrency")
        relative_benchmarks.append(
            {
                "concurrency": benchmark["concurrency"],
                "throughput_multiple": round(
                    benchmark["requests_per_second"] / baseline["requests_per_second"],
                    2,
                ),
                "latency_speedup": {
                    percentile: round(
                        baseline["latency_ms"][percentile]
                        / benchmark["latency_ms"][percentile],
                        2,
                    )
                    for percentile in ("p50", "p95", "p99")
                },
                "response_size_multiple": round(
                    baseline["mean_response_bytes"] / benchmark["mean_response_bytes"],
                    2,
                ),
            }
        )
    return {
        "name": comparison["name"],
        "idle": comparison_idle,
        "loaded": comparison_loaded,
        "observation": comparison_observation,
        "benchmarks": comparison_benchmarks,
        "relative_to_canary": {
            "idle_application_rss_multiple": round(
                comparison_idle["application_rss_kib"] / idle["application_rss_kib"],
                2,
            ),
            "peak_application_rss_multiple": round(
                comparison_loaded["application_peak_rss_kib"]
                / loaded["application_peak_rss_kib"],
                2,
            ),
            "benchmarks": relative_benchmarks,
        },
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
            "| Path | Concurrency | Requests/s | Mean bytes | p50 | p95 | p99 | Errors |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for benchmark in report["benchmarks"]:
        latency = benchmark["latency_ms"]
        lines.append(
            f"| `{benchmark['path']}` | {benchmark['concurrency']} | "
            f"{benchmark['requests_per_second']} | "
            f"{benchmark['mean_response_bytes']} | {latency['p50']} ms | "
            f"{latency['p95']} ms | {latency['p99']} ms | "
            f"{_render_errors(benchmark)} |"
        )
    comparison = report.get("comparison")
    if comparison is not None:
        relative = comparison["relative_to_canary"]
        lines.extend(
            [
                "",
                f"### Comparison: {comparison['name']}",
                "",
                f"Comparison idle RSS is "
                f"{relative['idle_application_rss_multiple']}x the Zig canary; "
                f"comparison peak RSS is "
                f"{relative['peak_application_rss_multiple']}x the Zig canary.",
                "",
                "| Concurrency | Zig req/s | Comparison req/s | Zig throughput multiple | Zig p95 | Comparison p95 | p95 speedup | Zig bytes | Comparison bytes | Comparison errors |",
                "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        comparison_by_concurrency = {
            benchmark["concurrency"]: benchmark
            for benchmark in comparison["benchmarks"]
        }
        relative_by_concurrency = {
            benchmark["concurrency"]: benchmark for benchmark in relative["benchmarks"]
        }
        for benchmark in report["benchmarks"]:
            baseline = comparison_by_concurrency[benchmark["concurrency"]]
            ratio = relative_by_concurrency[benchmark["concurrency"]]
            lines.append(
                f"| {benchmark['concurrency']} | "
                f"{benchmark['requests_per_second']} | "
                f"{baseline['requests_per_second']} | "
                f"{ratio['throughput_multiple']}x | "
                f"{benchmark['latency_ms']['p95']} ms | "
                f"{baseline['latency_ms']['p95']} ms | "
                f"{ratio['latency_speedup']['p95']}x | "
                f"{benchmark['mean_response_bytes']} | "
                f"{baseline['mean_response_bytes']} | "
                f"{_render_errors(baseline)} |"
            )
    return "\n".join(lines) + "\n"


def _render_errors(benchmark: dict[str, Any]) -> str:
    if benchmark["errors"] == 0:
        return "0"
    details = json.dumps(
        benchmark.get("error_counts", {}), sort_keys=True, separators=(",", ":")
    )
    return f"{benchmark['errors']} `{details}`"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idle", type=Path, required=True)
    parser.add_argument("--loaded", type=Path, required=True)
    parser.add_argument("--benchmark", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    parser.add_argument("--comparison-name")
    parser.add_argument("--comparison-idle", type=Path)
    parser.add_argument("--comparison-loaded", type=Path)
    parser.add_argument("--comparison-benchmark", type=Path, action="append")
    args = parser.parse_args()

    comparison_values = (
        args.comparison_name,
        args.comparison_idle,
        args.comparison_loaded,
        args.comparison_benchmark,
    )
    if any(comparison_values) and not all(comparison_values):
        parser.error("comparison arguments must be provided together")
    comparison = None
    if args.comparison_name:
        assert args.comparison_idle is not None
        assert args.comparison_loaded is not None
        assert args.comparison_benchmark is not None
        comparison = {
            "name": args.comparison_name,
            "idle": _read_object(args.comparison_idle),
            "loaded": _read_object(args.comparison_loaded),
            "benchmarks": [_read_object(path) for path in args.comparison_benchmark],
        }

    try:
        report = build_report(
            _read_object(args.idle),
            _read_object(args.loaded),
            [_read_object(path) for path in args.benchmark],
            comparison,
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    args.markdown_output.write_text(render_markdown(report))
    if not report["passed"]:
        raise SystemExit("canary exceeded its resource budget")


if __name__ == "__main__":
    main()

from __future__ import annotations

from typing import Any

import pytest
from canary_report import build_report, render_markdown


def _snapshot(
    *,
    rss_kib: int,
    peak_rss_kib: int,
    cpu_ticks: int,
    uptime: float,
) -> dict[str, int | float]:
    return {
        "pid": 42,
        "application_rss_kib": rss_kib,
        "application_peak_rss_kib": peak_rss_kib,
        "process_cpu_ticks": cpu_ticks,
        "clock_ticks_per_second": 100,
        "machine_uptime_seconds": uptime,
        "cgroup_current_bytes": rss_kib * 1024,
        "cgroup_peak_bytes": peak_rss_kib * 1024,
    }


def _benchmark(
    *,
    errors: int = 0,
    requests_per_second: float = 100.0,
    mean_response_bytes: float = 1_000.0,
) -> dict[str, Any]:
    return {
        "path": "/v1/tracks?limit=1",
        "concurrency": 16,
        "requests": 1000,
        "errors": errors,
        "error_counts": {"TimeoutError": errors} if errors else {},
        "status_counts": {"200": 1000},
        "requests_per_second": requests_per_second,
        "mean_response_bytes": mean_response_bytes,
        "latency_ms": {"p50": 1.0, "p95": 2.0, "p99": 3.0},
    }


def test_report_enforces_budgets_and_calculates_cpu() -> None:
    report = build_report(
        _snapshot(rss_kib=8_000, peak_rss_kib=8_500, cpu_ticks=100, uptime=10),
        _snapshot(rss_kib=9_000, peak_rss_kib=20_000, cpu_ticks=250, uptime=20),
        [_benchmark()],
    )

    assert report["passed"] is True
    assert report["observation"] == {
        "wall_seconds": 10,
        "application_cpu_seconds": 1.5,
        "mean_single_core_cpu_percent": 15.0,
    }
    markdown = render_markdown(report)
    assert "Zig canary evidence" in markdown
    assert "100.0" in markdown
    assert "p99" in markdown


@pytest.mark.parametrize(
    ("idle_rss", "peak_rss", "failed_gate"),
    [
        (16 * 1024 + 1, 20_000, "idle_application_rss_kib"),
        (8_000, 64 * 1024 + 1, "peak_application_rss_kib"),
    ],
)
def test_report_records_a_failed_resource_gate(
    idle_rss: int, peak_rss: int, failed_gate: str
) -> None:
    report = build_report(
        _snapshot(rss_kib=idle_rss, peak_rss_kib=idle_rss, cpu_ticks=100, uptime=10),
        _snapshot(rss_kib=9_000, peak_rss_kib=peak_rss, cpu_ticks=200, uptime=20),
        [_benchmark()],
    )

    assert report["passed"] is False
    assert report["budgets"][failed_gate]["passed"] is False


def test_report_rejects_restarts_and_request_errors() -> None:
    idle = _snapshot(rss_kib=8_000, peak_rss_kib=8_000, cpu_ticks=100, uptime=10)
    loaded = _snapshot(rss_kib=9_000, peak_rss_kib=9_000, cpu_ticks=200, uptime=20)
    loaded["pid"] = 43
    with pytest.raises(ValueError, match="restarted"):
        build_report(idle, loaded, [_benchmark()])
    loaded["pid"] = 42
    with pytest.raises(ValueError, match="without errors"):
        build_report(idle, loaded, [_benchmark(errors=1)])


def test_report_requires_unique_matching_concurrency_levels() -> None:
    idle = _snapshot(rss_kib=8_000, peak_rss_kib=8_000, cpu_ticks=100, uptime=10)
    loaded = _snapshot(rss_kib=9_000, peak_rss_kib=9_000, cpu_ticks=200, uptime=20)
    benchmark = _benchmark()
    with pytest.raises(ValueError, match="unique"):
        build_report(idle, loaded, [benchmark, benchmark])

    comparison_benchmark = _benchmark()
    comparison_benchmark["concurrency"] = 1
    with pytest.raises(ValueError, match="exactly match"):
        build_report(
            idle,
            loaded,
            [benchmark],
            {
                "name": "Python staging API",
                "idle": _snapshot(
                    rss_kib=512_000,
                    peak_rss_kib=600_000,
                    cpu_ticks=1_000,
                    uptime=30,
                ),
                "loaded": _snapshot(
                    rss_kib=520_000,
                    peak_rss_kib=640_000,
                    cpu_ticks=1_500,
                    uptime=40,
                ),
                "benchmarks": [comparison_benchmark],
            },
        )


def test_report_compares_resources_payloads_and_http_performance() -> None:
    report = build_report(
        _snapshot(rss_kib=8_000, peak_rss_kib=9_000, cpu_ticks=100, uptime=10),
        _snapshot(rss_kib=9_000, peak_rss_kib=10_000, cpu_ticks=200, uptime=20),
        [_benchmark(requests_per_second=200.0, mean_response_bytes=2_000)],
        {
            "name": "Python staging API",
            "idle": _snapshot(
                rss_kib=512_000,
                peak_rss_kib=600_000,
                cpu_ticks=1_000,
                uptime=30,
            ),
            "loaded": _snapshot(
                rss_kib=520_000,
                peak_rss_kib=640_000,
                cpu_ticks=1_500,
                uptime=40,
            ),
            "benchmarks": [
                _benchmark(
                    errors=1,
                    requests_per_second=10.0,
                    mean_response_bytes=4_000,
                )
            ],
        },
    )

    relative = report["comparison"]["relative_to_canary"]
    assert report["passed"] is True
    assert relative["idle_application_rss_multiple"] == 64.0
    assert relative["peak_application_rss_multiple"] == 64.0
    assert relative["benchmarks"][0]["throughput_multiple"] == 20.0
    assert relative["benchmarks"][0]["response_size_multiple"] == 2.0
    assert all(gate["passed"] for gate in report["efficiency_gates"].values())
    markdown = render_markdown(report)
    assert "Comparison: Python staging API" in markdown
    assert "Efficiency gate" in markdown
    assert "Comparison errors" in markdown
    assert "TimeoutError" in markdown


@pytest.mark.parametrize(
    ("comparison_idle_rss", "comparison_peak_rss", "comparison_rps", "failed_gate"),
    [
        (399_999, 600_000, 10.0, "idle_application_rss_multiple"),
        (400_000, 499_999, 10.0, "peak_application_rss_multiple"),
        (512_000, 600_000, 10.01, "throughput_multiple_at_concurrency_16"),
    ],
)
def test_report_fails_when_relative_efficiency_is_not_material(
    comparison_idle_rss: int,
    comparison_peak_rss: int,
    comparison_rps: float,
    failed_gate: str,
) -> None:
    report = build_report(
        _snapshot(rss_kib=8_000, peak_rss_kib=9_000, cpu_ticks=100, uptime=10),
        _snapshot(rss_kib=9_000, peak_rss_kib=10_000, cpu_ticks=200, uptime=20),
        [_benchmark(requests_per_second=100.0)],
        {
            "name": "Python staging API",
            "idle": _snapshot(
                rss_kib=comparison_idle_rss,
                peak_rss_kib=comparison_idle_rss,
                cpu_ticks=1_000,
                uptime=30,
            ),
            "loaded": _snapshot(
                rss_kib=comparison_idle_rss,
                peak_rss_kib=comparison_peak_rss,
                cpu_ticks=1_500,
                uptime=40,
            ),
            "benchmarks": [_benchmark(requests_per_second=comparison_rps)],
        },
    )

    assert report["passed"] is False
    assert report["efficiency_gates"][failed_gate]["passed"] is False

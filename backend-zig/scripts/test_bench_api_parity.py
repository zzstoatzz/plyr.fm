from __future__ import annotations

from unittest.mock import Mock

import pytest
from bench_api_parity import (
    _relative,
    require_disposable_database,
    validate_python_collection,
    validate_zig_collection,
)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://localhost/plyr",
        "postgresql://db.example/plyr_bench",
        "postgresql://localhost/plyr_bench_extra",
    ],
)
def test_benchmark_rejects_non_disposable_databases(url: str) -> None:
    with pytest.raises(ValueError):
        require_disposable_database(url)


def test_benchmark_accepts_only_local_named_database() -> None:
    require_disposable_database("postgresql://localhost:5432/plyr_bench")


def test_semantic_probes_require_fifty_paginated_tracks(monkeypatch) -> None:
    target = Mock()
    monkeypatch.setattr(
        "bench_api_parity._request_json",
        lambda _target, path: {
            **(
                {"tracks": [{}] * 50}
                if path.startswith("/tracks/")
                else {"object": "list", "data": [{}] * 50}
            ),
            "has_more": True,
        },
    )

    validate_python_collection(target)
    validate_zig_collection(target)


def test_relative_report_compares_real_work_not_response_size() -> None:
    python = {
        "requests_per_second": 100.0,
        "resident_set_kib": 400_000,
        "responses_per_cpu_second": 200.0,
    }
    zig = {
        "requests_per_second": 1_000.0,
        "resident_set_kib": 4_000,
        "responses_per_cpu_second": 4_000.0,
    }

    assert _relative(python, zig) == {
        "throughput_multiple": 10.0,
        "rss_reduction_multiple": 100.0,
        "cpu_efficiency_multiple": 20.0,
    }

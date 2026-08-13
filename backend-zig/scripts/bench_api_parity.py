"""Compare equivalent database-backed catalogue reads in Python and Zig."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from bench_http import HttpTarget, benchmark_process

REPOSITORY = Path(__file__).resolve().parents[2]
BACKEND = REPOSITORY / "backend"
ZIG_BACKEND = REPOSITORY / "backend-zig"
TEST_ENCRYPTION_KEY = "hnSkDmgbbuK0rt7Ab3eJHAktb18gmebsdwKdTmq9mes="


def require_disposable_database(database_url: str) -> None:
    """Refuse a benchmark database that could contain durable application data."""
    parsed = urlsplit(database_url)
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("API parity benchmark requires local Postgres")
    if parsed.path != "/plyr_bench":
        raise ValueError("API parity benchmark requires the plyr_bench database")


def _request_json(target: HttpTarget, path: str) -> dict[str, Any]:
    connection = target.connect()
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        body = response.read()
    finally:
        connection.close()
    if response.status != 200:
        raise RuntimeError(f"semantic probe returned HTTP {response.status}")
    value = json.loads(body)
    if not isinstance(value, dict):
        raise RuntimeError("semantic probe did not return an object")
    return value


def validate_python_collection(target: HttpTarget) -> None:
    payload = _request_json(target, "/tracks/?limit=50")
    tracks = payload.get("tracks")
    if not isinstance(tracks, list) or len(tracks) != 50:
        raise RuntimeError("Python fixture did not return 50 tracks")
    if payload.get("has_more") is not True:
        raise RuntimeError("Python fixture did not prove bounded pagination")


def validate_zig_collection(target: HttpTarget) -> None:
    payload = _request_json(target, "/v1/tracks?limit=50")
    tracks = payload.get("data")
    if payload.get("object") != "list" or not isinstance(tracks, list):
        raise RuntimeError("Zig fixture did not return a list resource")
    if len(tracks) != 50 or payload.get("has_more") is not True:
        raise RuntimeError("Zig fixture did not prove bounded pagination")


def _python_environment(
    database_url: str, docket_url: str, concurrency: int
) -> dict[str, str]:
    return {
        **os.environ,
        "DATABASE_URL": database_url,
        "DATABASE_POOL_SIZE": str(max(16, concurrency)),
        "DATABASE_MAX_OVERFLOW": "0",
        "DATABASE_POOL_PRE_PING": "false",
        "DOCKET_URL": docket_url,
        "DOCKET_ENABLED": "false",
        "RATE_LIMIT_ENABLED": "false",
        "OAUTH_ENCRYPTION_KEY": TEST_ENCRYPTION_KEY,
        "LOGFIRE_IGNORE_NO_CONFIG": "1",
    }


def _zig_environment(database_url: str, concurrency: int) -> dict[str, str]:
    return {
        **os.environ,
        "MODE": "api",
        "DATABASE_URL": database_url,
        "DATABASE_POOL_SIZE": str(max(16, concurrency)),
        "MAX_CONNECTIONS": str(max(32, concurrency)),
        "INDEX_MODE": "required",
        "TRACK_COLLECTION_NSID": "fm.plyr.dev.track",
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
    }


def _number(result: dict[str, object], key: str) -> float:
    value = result.get(key)
    if not isinstance(value, int | float):
        raise RuntimeError(f"benchmark result omitted numeric {key}")
    return float(value)


def _relative(python: dict[str, object], zig: dict[str, object]) -> dict[str, float]:
    python_rps = _number(python, "requests_per_second")
    zig_rps = _number(zig, "requests_per_second")
    python_rss = _number(python, "resident_set_kib")
    zig_rss = _number(zig, "resident_set_kib")
    relative = {
        "throughput_multiple": round(zig_rps / python_rps, 2),
        "rss_reduction_multiple": round(python_rss / zig_rss, 2),
    }
    python_cpu = python.get("responses_per_cpu_second")
    zig_cpu = zig.get("responses_per_cpu_second")
    if isinstance(python_cpu, int | float) and isinstance(zig_cpu, int | float):
        relative["cpu_efficiency_multiple"] = round(zig_cpu / python_cpu, 2)
    return relative


def _require_clean(result: dict[str, object]) -> None:
    if result.get("errors") != 0:
        raise RuntimeError("API parity benchmark completed with request errors")
    requests = result.get("requests")
    if not isinstance(requests, int) or requests <= 0:
        raise RuntimeError("API parity benchmark completed no requests")


def run(
    database_url: str, docket_url: str, duration: float, concurrencies: list[int]
) -> dict[str, object]:
    require_disposable_database(database_url)
    python_results: list[dict[str, object]] = []
    zig_results: list[dict[str, object]] = []
    relative: list[dict[str, float | int]] = []
    for concurrency in concurrencies:
        python_result = benchmark_process(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "backend.main:app",
                "--app-dir",
                str(BACKEND / "src"),
                "--host",
                "127.0.0.1",
                "--no-access-log",
            ],
            REPOSITORY,
            _python_environment(database_url, docket_url, concurrency),
            duration,
            concurrency,
            "/tracks/?limit=50",
            200,
            validate=validate_python_collection,
            port_argument="--port",
        )
        zig_result = benchmark_process(
            [ZIG_BACKEND / "zig-out/bin/plyr-backend"],
            ZIG_BACKEND,
            _zig_environment(database_url, concurrency),
            duration,
            concurrency,
            "/v1/tracks?limit=50",
            200,
            validate=validate_zig_collection,
        )
        _require_clean(python_result)
        _require_clean(zig_result)
        python_results.append(python_result)
        zig_results.append(zig_result)
        relative.append(
            {"concurrency": concurrency, **_relative(python_result, zig_result)}
        )
    return {
        "fixture": {"public_tracks": 100, "page_size": 50, "database": "plyr_bench"},
        "python": python_results,
        "zig": zig_results,
        "relative": relative,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument(
        "--concurrency", type=int, action="append", dest="concurrencies"
    )
    args = parser.parse_args()
    concurrencies = args.concurrencies or [1, 16]
    if args.duration <= 0 or any(value <= 0 for value in concurrencies):
        parser.error("duration and concurrency must be positive")
    database_url = os.environ.get("DATABASE_URL")
    docket_url = os.environ.get("DOCKET_URL")
    if not database_url or not docket_url:
        parser.error("DATABASE_URL and DOCKET_URL are required")
    assert database_url is not None and docket_url is not None
    try:
        report = run(database_url, docket_url, args.duration, concurrencies)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

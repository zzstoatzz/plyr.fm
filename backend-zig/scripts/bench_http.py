"""Repeatable local throughput/latency benchmark for the Zig HTTP boundary."""

from __future__ import annotations

import argparse
import http.client
import json
import os
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class WorkerResult:
    latencies_ns: list[int]
    errors: int


def _unused_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_until_ready(port: int, process: subprocess.Popen[bytes]) -> None:
    for _ in range(200):
        if process.poll() is not None:
            stderr = process.stderr.read().decode() if process.stderr else ""
            raise RuntimeError(f"server exited before benchmark:\n{stderr}")
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            connection.request("GET", "/health")
            response = connection.getresponse()
            response.read()
            connection.close()
            if response.status == 200:
                return
        except OSError:
            time.sleep(0.01)
    raise TimeoutError("Zig API did not become ready")


def _worker(
    port: int,
    path: str,
    expected_status: int,
    duration: float,
    start: threading.Event,
) -> WorkerResult:
    latencies: list[int] = []
    errors = 0
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    start.wait()
    deadline = time.perf_counter() + duration
    try:
        while time.perf_counter() < deadline:
            began = time.perf_counter_ns()
            try:
                connection.request("GET", path)
                response = connection.getresponse()
                response.read()
                if response.status != expected_status:
                    errors += 1
                else:
                    latencies.append(time.perf_counter_ns() - began)
            except (OSError, http.client.HTTPException):
                errors += 1
                connection.close()
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    finally:
        connection.close()
    return WorkerResult(latencies, errors)


def _percentile(sorted_values: list[int], percentile: float) -> float:
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, int((len(sorted_values) - 1) * percentile))
    return sorted_values[index] / 1_000_000


def benchmark(
    duration: float,
    concurrency: int,
    path: str,
    expected_status: int,
    database_url: str | None,
) -> dict[str, object]:
    port = _unused_port()
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "TRACK_COLLECTION_NSID": "fm.plyr.dev.track",
        "INDEX_MODE": "required" if database_url else "disabled",
        "MAX_CONNECTIONS": str(max(concurrency, 8)),
    }
    if database_url:
        environment["DATABASE_URL"] = database_url
    else:
        environment.pop("DATABASE_URL", None)
    process = subprocess.Popen(
        [ROOT / "zig-out/bin/plyr-backend"],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_until_ready(port, process)
        start = threading.Event()
        threads: list[threading.Thread] = []
        results: list[WorkerResult | None] = [None] * concurrency

        def run(index: int) -> None:
            results[index] = _worker(port, path, expected_status, duration, start)

        for index in range(concurrency):
            thread = threading.Thread(target=run, args=(index,))
            thread.start()
            threads.append(thread)
        began = time.perf_counter()
        start.set()
        for thread in threads:
            thread.join()
        elapsed = time.perf_counter() - began

        completed = [result for result in results if result is not None]
        latencies = sorted(
            latency for result in completed for latency in result.latencies_ns
        )
        errors = sum(result.errors for result in completed)
        return {
            "path": path,
            "expected_status": expected_status,
            "duration_seconds": round(elapsed, 3),
            "concurrency": concurrency,
            "requests": len(latencies),
            "errors": errors,
            "requests_per_second": round(len(latencies) / elapsed, 1),
            "latency_ms": {
                "p50": round(_percentile(latencies, 0.50), 3),
                "p95": round(_percentile(latencies, 0.95), 3),
                "p99": round(_percentile(latencies, 0.99), 3),
            },
        }
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=float, default=3.0)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--path", default="/health")
    parser.add_argument("--expect-status", type=int, default=200)
    parser.add_argument(
        "--with-index",
        action="store_true",
        help="use DATABASE_URL from the environment and require index readiness",
    )
    args = parser.parse_args()
    if args.duration <= 0 or args.concurrency <= 0:
        parser.error("duration and concurrency must be positive")
    database_url = os.environ.get("DATABASE_URL") if args.with_index else None
    if args.with_index and not database_url:
        parser.error("--with-index requires DATABASE_URL in the environment")
    print(
        json.dumps(
            benchmark(
                args.duration,
                args.concurrency,
                args.path,
                args.expect_status,
                database_url,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

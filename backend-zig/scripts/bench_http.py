"""Repeatable local or deployed throughput benchmark for the Zig HTTP boundary."""

from __future__ import annotations

import argparse
import http.client
import json
import os
import socket
import subprocess
import threading
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import SplitResult, urlsplit

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class WorkerResult:
    latencies_ns: list[int]
    error_counts: Counter[str]
    status_counts: Counter[int]
    response_bytes: int


@dataclass(frozen=True)
class HttpTarget:
    scheme: str
    host: str
    port: int

    def connect(self) -> http.client.HTTPConnection:
        connection_type = (
            http.client.HTTPSConnection
            if self.scheme == "https"
            else http.client.HTTPConnection
        )
        return connection_type(self.host, self.port, timeout=5)


def parse_target(value: str) -> HttpTarget:
    parsed: SplitResult = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("benchmark URL must use http or https")
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("benchmark URL must contain an unauthenticated host")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("benchmark URL must not contain a path, query, or fragment")
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("benchmark URL has an invalid port") from error
    return HttpTarget(
        parsed.scheme,
        parsed.hostname,
        port or (443 if parsed.scheme == "https" else 80),
    )


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
    target: HttpTarget,
    path: str,
    expected_status: int,
    duration: float,
    start: threading.Event,
) -> WorkerResult:
    latencies: list[int] = []
    error_counts: Counter[str] = Counter()
    status_counts: Counter[int] = Counter()
    response_bytes = 0
    connection: http.client.HTTPConnection | None = None
    start.wait()
    deadline = time.perf_counter() + duration
    try:
        while time.perf_counter() < deadline:
            began = time.perf_counter_ns()
            try:
                if connection is None:
                    connection = target.connect()
                connection.request("GET", path)
                response = connection.getresponse()
                body = response.read()
                status_counts[response.status] += 1
                if response.status != expected_status:
                    error_counts[f"http_status_{response.status}"] += 1
                else:
                    latencies.append(time.perf_counter_ns() - began)
                    response_bytes += len(body)
            except (OSError, http.client.HTTPException) as error:
                error_counts[type(error).__name__] += 1
                if connection is not None:
                    connection.close()
                    connection = None
    finally:
        if connection is not None:
            connection.close()
    return WorkerResult(latencies, error_counts, status_counts, response_bytes)


def _percentile(sorted_values: list[int], percentile: float) -> float:
    if not sorted_values:
        return 0.0
    index = min(len(sorted_values) - 1, int((len(sorted_values) - 1) * percentile))
    return sorted_values[index] / 1_000_000


def _resident_set_kib(process: subprocess.Popen[bytes]) -> int | None:
    measured = subprocess.run(
        ["ps", "-o", "rss=", "-p", str(process.pid)],
        check=False,
        capture_output=True,
        text=True,
    )
    if measured.returncode != 0 or not measured.stdout.strip().isdigit():
        return None
    return int(measured.stdout.strip())


def benchmark_target(
    target: HttpTarget,
    duration: float,
    concurrency: int,
    path: str,
    expected_status: int,
) -> dict[str, object]:
    start = threading.Event()
    threads: list[threading.Thread] = []
    results: list[WorkerResult | None] = [None] * concurrency

    def run(index: int) -> None:
        results[index] = _worker(target, path, expected_status, duration, start)

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
    workers_completed = len(completed)
    error_counts: Counter[str] = Counter()
    status_counts: Counter[int] = Counter()
    for result in completed:
        error_counts.update(result.error_counts)
        status_counts.update(result.status_counts)
    if workers_completed != concurrency:
        error_counts["worker_crash"] += concurrency - workers_completed
    errors = sum(error_counts.values())
    response_bytes = sum(result.response_bytes for result in completed)
    return {
        "target": f"{target.scheme}://{target.host}:{target.port}",
        "path": path,
        "expected_status": expected_status,
        "duration_seconds": round(elapsed, 3),
        "concurrency": concurrency,
        "workers_completed": workers_completed,
        "requests": len(latencies),
        "errors": errors,
        "error_counts": dict(sorted(error_counts.items())),
        "status_counts": {
            str(status): count for status, count in sorted(status_counts.items())
        },
        "response_bytes": response_bytes,
        "mean_response_bytes": round(response_bytes / len(latencies), 1)
        if latencies
        else 0,
        "requests_per_second": round(len(latencies) / elapsed, 1),
        "latency_ms": {
            "p50": round(_percentile(latencies, 0.50), 3),
            "p95": round(_percentile(latencies, 0.95), 3),
            "p99": round(_percentile(latencies, 0.99), 3),
        },
    }


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
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
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
        result = benchmark_target(
            HttpTarget("http", "127.0.0.1", port),
            duration,
            concurrency,
            path,
            expected_status,
        )
        result["resident_set_kib"] = _resident_set_kib(process)
        return result
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
        "--url",
        help="benchmark a deployed base URL instead of starting a local Zig process",
    )
    parser.add_argument(
        "--with-index",
        action="store_true",
        help="use DATABASE_URL from the environment and require index readiness",
    )
    args = parser.parse_args()
    if args.duration <= 0 or args.concurrency <= 0:
        parser.error("duration and concurrency must be positive")
    if args.url and args.with_index:
        parser.error("--url and --with-index are mutually exclusive")
    try:
        target = parse_target(args.url) if args.url else None
    except ValueError as error:
        parser.error(str(error))
    database_url = os.environ.get("DATABASE_URL") if args.with_index else None
    if args.with_index and not database_url:
        parser.error("--with-index requires DATABASE_URL in the environment")
    print(
        json.dumps(
            benchmark_target(
                target,
                args.duration,
                args.concurrency,
                args.path,
                args.expect_status,
            )
            if target
            else benchmark(
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

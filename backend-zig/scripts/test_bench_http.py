from __future__ import annotations

import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from bench_http import HttpTarget, benchmark_target, parse_cpu_time, parse_target

SCRIPTS = Path(__file__).resolve().parent


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        del format, args


class _CookieHandler(_Handler):
    def do_GET(self) -> None:
        if self.headers.get("Cookie") != "__Host-plyr_session=test-token":
            self.send_response(401)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_GET()


def test_parse_target_applies_scheme_default_ports() -> None:
    assert parse_target("https://next.plyr.fm") == HttpTarget(
        "https", "next.plyr.fm", 443
    )
    assert parse_target("http://127.0.0.1:8000/") == HttpTarget(
        "http", "127.0.0.1", 8000
    )


@pytest.mark.parametrize(
    "value",
    [
        "next.plyr.fm",
        "ftp://next.plyr.fm",
        "https://user@next.plyr.fm",
        "https://next.plyr.fm/v1/tracks",
        "https://next.plyr.fm?limit=1",
        "https://next.plyr.fm:invalid",
    ],
)
def test_parse_target_rejects_ambiguous_base_urls(value: str) -> None:
    with pytest.raises(ValueError):
        parse_target(value)


@pytest.mark.parametrize(
    ("value", "seconds"),
    [("00:01.25", 1.25), ("02:03.50", 123.5), ("1:02:03.25", 3723.25)],
)
def test_parse_cpu_time(value: str, seconds: float) -> None:
    assert parse_cpu_time(value) == seconds


@pytest.mark.parametrize("value", ["", "one:two", "1:60:00", "1:2:3:4", "-1"])
def test_parse_cpu_time_rejects_malformed_values(value: str) -> None:
    with pytest.raises(ValueError):
        parse_cpu_time(value)


def test_benchmark_target_measures_a_real_http_connection() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        result = benchmark_target(
            HttpTarget("http", "127.0.0.1", server.server_port),
            duration=0.2,
            concurrency=2,
            path="/v1/tracks?limit=1",
            expected_status=200,
        )
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert result["requests"] > 0
    assert result["errors"] == 0
    assert result["error_counts"] == {}
    assert result["status_counts"] == {"200": result["requests"]}
    assert result["workers_completed"] == 2
    assert result["requests_per_second"] > 0
    assert result["response_bytes"] == result["requests"] * len(b'{"ok":true}')
    assert result["mean_response_bytes"] == len(b'{"ok":true}')
    assert result["latency_ms"]["p99"] > 0


def test_benchmark_target_explains_unexpected_statuses() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        result = benchmark_target(
            HttpTarget("http", "127.0.0.1", server.server_port),
            duration=0.1,
            concurrency=1,
            path="/v1/tracks?limit=1",
            expected_status=201,
        )
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert result["requests"] == 0
    assert result["errors"] > 0
    assert result["error_counts"] == {"http_status_200": result["errors"]}
    assert result["status_counts"] == {"200": result["errors"]}


def test_benchmark_target_sends_confidential_headers_without_reporting_them() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _CookieHandler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        result = benchmark_target(
            HttpTarget("http", "127.0.0.1", server.server_port),
            duration=0.1,
            concurrency=1,
            path="/auth/me",
            expected_status=200,
            request_headers={"Cookie": "__Host-plyr_session=test-token"},
        )
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert result["errors"] == 0
    assert result["requests"] > 0
    assert "test-token" not in json.dumps(result)


@pytest.mark.parametrize("cgroup_version", [1, 2])
def test_resource_snapshot_reads_application_and_cgroup_counters(
    tmp_path: Path, cgroup_version: int
) -> None:
    process_exe = tmp_path / "plyr-backend"
    process_exe.write_bytes(b"")
    proc_root = tmp_path / "proc"
    process = proc_root / "42"
    process.mkdir(parents=True)
    (process / "exe").symlink_to(process_exe)
    (process / "status").write_text(
        "Name:\tplyr-backend\nVmHWM:\t8192 kB\nVmRSS:\t4096 kB\n"
    )
    stat_fields = ["0"] * 52
    stat_fields[0] = "42"
    stat_fields[1] = "(plyr-backend)"
    stat_fields[2] = "S"
    stat_fields[13] = "120"
    stat_fields[14] = "30"
    (process / "stat").write_text(" ".join(stat_fields) + "\n")
    (proc_root / "uptime").write_text("12.50 0.00\n")
    cgroup_root = tmp_path / "cgroup"
    cgroup_root.mkdir()
    if cgroup_version == 2:
        (cgroup_root / "memory.current").write_text("10485760\n")
        (cgroup_root / "memory.peak").write_text("12582912\n")
    else:
        memory_root = cgroup_root / "memory"
        memory_root.mkdir()
        (memory_root / "memory.usage_in_bytes").write_text("10485760\n")
        (memory_root / "memory.max_usage_in_bytes").write_text("12582912\n")

    completed = subprocess.run(
        ["sh", SCRIPTS / "canary-resource-snapshot"],
        check=True,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PROCESS_EXE": str(process_exe),
            "PROC_ROOT": str(proc_root),
            "CGROUP_ROOT": str(cgroup_root),
        },
    )

    snapshot = json.loads(completed.stdout)
    assert snapshot["pid"] == 42
    assert snapshot["application_rss_kib"] == 4096
    assert snapshot["application_peak_rss_kib"] == 8192
    assert snapshot["process_cpu_ticks"] == 150
    assert snapshot["machine_uptime_seconds"] == 12.5
    assert snapshot["cgroup_current_bytes"] == 10485760
    assert snapshot["cgroup_peak_bytes"] == 12582912

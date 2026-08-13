"""Assert the ranked-like projection fixture through the public HTTP API."""

from __future__ import annotations

import os
import subprocess

from test_http import _request, _unused_port, _wait_until_ready

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url or not database_url.endswith("/zig_bench"):
        raise RuntimeError("chart contract requires the disposable zig_bench database")
    port = _unused_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "TRACK_COLLECTION_NSID": "fm.plyr.dev.track",
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
        "INDEX_MODE": "required",
        "DATABASE_POOL_SIZE": "4",
        "MAX_CONNECTIONS": "4",
    }
    process = subprocess.Popen(
        [os.path.join(ROOT, "zig-out/bin/plyr-backend")],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_until_ready(base_url, process)
        status, _, body = _request(
            base_url, "/v1/charts/tracks?period=all_time&limit=10"
        )
        assert status == 200
        assert body["object"] == "track_chart" and body["period"] == "all_time"
        entries = body["data"]
        expected_counts = list(range(100, 90, -1))
        assert [entry["rank"] for entry in entries] == list(range(1, 11))
        assert [entry["period_like_count"] for entry in entries] == expected_counts
        assert [entry["all_time_like_count"] for entry in entries] == expected_counts
        assert [entry["track"]["record"]["uri"] for entry in entries] == [
            f"at://did:plc:bench/fm.plyr.dev.track/track-{number}"
            for number in range(100, 90, -1)
        ]
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


if __name__ == "__main__":
    main()

"""Exercise durable play receipts over HTTP against disposable Postgres."""

from __future__ import annotations

import base64
import concurrent.futures
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = "postgresql://zig_test:zig_test@127.0.0.1:5435/zig_test"
COLLECTION = "fm.plyr.dev.track"
RECORD_URI = f"at://did:plc:artist/{COLLECTION}/play-http"
SECOND_URI = f"at://did:plc:artist/{COLLECTION}/second"
COOKIE = "plyr_play_id=abcdefghijklmnopqrstuv"


def _track_id(uri: str) -> str:
    payload = base64.urlsafe_b64encode(uri.encode()).decode().rstrip("=")
    return f"trk_{payload}"


def _unused_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _prepare_database() -> None:
    with psycopg.connect(DATABASE_URL) as connection:
        database_name = connection.execute("SELECT current_database()").fetchone()[0]
        if database_name != "zig_test":
            raise RuntimeError(f"unsafe play HTTP database: {database_name!r}")
        connection.execute("DROP SCHEMA IF EXISTS plyr_index CASCADE")
        connection.execute("DROP TABLE IF EXISTS tracks CASCADE")
        connection.execute("CREATE SCHEMA plyr_index")
        connection.execute(
            "CREATE TABLE tracks (atproto_record_uri text PRIMARY KEY, play_count integer)"
        )
        connection.execute(
            "CREATE TABLE plyr_index.track_records (record_uri text PRIMARY KEY, "
            "owner_did text NOT NULL, duration_seconds bigint, "
            "self_labels text[] NOT NULL DEFAULT '{}', deleted boolean NOT NULL DEFAULT false)"
        )
        connection.execute(
            "CREATE TABLE plyr_index.account_availability (repo_did text PRIMARY KEY, "
            "available boolean NOT NULL)"
        )
        connection.execute(
            "CREATE TABLE plyr_index.track_policies (record_uri text PRIMARY KEY, "
            "visibility text NOT NULL, operator_labels jsonb NOT NULL DEFAULT '[]', "
            "moderation_decision text)"
        )
        connection.execute(
            "CREATE TABLE plyr_index.track_metrics (record_uri text PRIMARY KEY, "
            "play_count bigint NOT NULL CHECK(play_count >= 0), "
            "write_source text NOT NULL, observed_at_us bigint NOT NULL)"
        )
        connection.execute(
            "INSERT INTO plyr_index.account_availability VALUES ('did:plc:artist', true)"
        )
        for uri in (RECORD_URI, SECOND_URI):
            connection.execute("INSERT INTO tracks VALUES (%s, 7)", (uri,))
            connection.execute(
                "INSERT INTO plyr_index.track_records (record_uri, owner_did, duration_seconds) "
                "VALUES (%s, 'did:plc:artist', 180)",
                (uri,),
            )
            connection.execute(
                "INSERT INTO plyr_index.track_policies VALUES (%s, 'public', '[]', NULL)",
                (uri,),
            )
            connection.execute(
                "INSERT INTO plyr_index.track_metrics VALUES (%s, 7, 'test_fixture', 1)",
                (uri,),
            )
        connection.execute(
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'play_http_api') THEN CREATE ROLE play_http_api LOGIN PASSWORD 'local-fixture-password'; END IF; END $$"
        )
        connection.execute(
            "ALTER ROLE play_http_api SET default_transaction_read_only = on"
        )
        connection.execute(
            (ROOT / "migrations/0031_add_durable_play_receipts.sql").read_text()
        )
        connection.execute("GRANT USAGE ON SCHEMA plyr_index TO play_http_api")
        connection.execute(
            "GRANT SELECT ON ALL TABLES IN SCHEMA plyr_index TO play_http_api"
        )
        connection.execute(
            "GRANT INSERT, UPDATE ON plyr_index.track_metrics TO play_http_api"
        )
        connection.execute("GRANT INSERT ON plyr_index.play_receipts TO play_http_api")
        connection.execute(
            "GRANT INSERT, UPDATE, DELETE ON plyr_index.play_cooldowns TO play_http_api"
        )
        connection.execute(
            "GRANT EXECUTE ON FUNCTION plyr_index.record_play(UUID, TEXT, BYTEA) TO play_http_api"
        )


def _request(
    base_url: str, path: str, *, cookie: str | None = None
) -> tuple[int, dict[str, str], dict[str, Any]]:
    headers = {"Accept": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(
        f"{base_url}{path}", headers=headers, method="POST"
    )
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return (
            response.status,
            {key.lower(): value for key, value in response.headers.items()},
            json.loads(response.read()),
        )


def _wait_until_ready(base_url: str, process: subprocess.Popen[bytes]) -> None:
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("server exited before readiness")
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.02)
    raise TimeoutError("Zig play API did not become ready")


def _path(occurrence: str, uri: str = RECORD_URI) -> str:
    return f"/v1/tracks/{_track_id(uri)}/plays?occurrence={occurrence}"


def _sql(query: str, params: tuple[Any, ...] = ()) -> Any:
    with psycopg.connect(DATABASE_URL) as connection:
        result = connection.execute(query, params)
        return result.fetchone() if result.description else None


def _exercise(base_url: str) -> None:
    occurrence = str(uuid.uuid4())
    path = _path(occurrence)
    status, headers, first = _request(base_url, path)
    assert status == 200, first
    assert first["counted"] is True and first["play_count"] == 8
    assert first["occurrence"] == occurrence
    assert first["dedup"] == {"status": "claimed", "window_seconds": 180}
    assert headers["set-cookie"].startswith("plyr_play_id=")

    status, _, replay = _request(base_url, path)
    assert status == 200 and replay["counted"] and replay["play_count"] == 8
    assert replay["dedup"]["status"] == "duplicate"
    assert _request(base_url, _path(occurrence, SECOND_URI))[0] == 409
    assert _request(base_url, path + "&occurrence=" + occurrence)[0] == 400
    assert _request(base_url, _path("not-a-uuid"))[0] == 400
    assert _request(base_url, path.split("?", 1)[0])[0] == 400

    status, _, counted = _request(base_url, _path(str(uuid.uuid4())), cookie=COOKIE)
    assert status == 200 and counted["counted"] and counted["play_count"] == 9
    suppressed_id = str(uuid.uuid4())
    status, _, suppressed = _request(base_url, _path(suppressed_id), cookie=COOKIE)
    assert status == 200 and not suppressed["counted"]
    assert suppressed["dedup"]["status"] == "suppressed"
    _sql(
        "UPDATE plyr_index.play_cooldowns SET expires_at = now() - interval '1 second'"
    )
    status, _, replay_suppressed = _request(base_url, _path(suppressed_id))
    assert status == 200 and not replay_suppressed["counted"]
    assert replay_suppressed["play_count"] == suppressed["play_count"]

    _sql(
        "ALTER TABLE plyr_index.track_metrics ADD CONSTRAINT reject_test_play CHECK(play_count <= 9)"
    )
    failed_id = str(uuid.uuid4())
    status, _, _ = _request(base_url, _path(failed_id), cookie=COOKIE)
    assert status == 503
    assert _sql(
        "SELECT count(*) FROM plyr_index.play_receipts WHERE occurrence = %s",
        (failed_id,),
    ) == (0,)
    _sql("ALTER TABLE plyr_index.track_metrics DROP CONSTRAINT reject_test_play")
    status, _, recovered = _request(base_url, _path(failed_id), cookie=COOKIE)
    assert status == 200 and recovered["counted"] and recovered["play_count"] == 10

    concurrent_id = str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda _: _request(base_url, _path(concurrent_id)), range(16))
        )
    assert all(
        status == 200 and body["play_count"] == 11 and body["counted"]
        for status, _, body in results
    ), results
    assert sum(body["dedup"]["status"] == "claimed" for _, _, body in results) == 1
    assert _sql(
        "SELECT count(*) FROM plyr_index.play_receipts WHERE occurrence = %s",
        (concurrent_id,),
    ) == (1,)

    _sql(
        "UPDATE plyr_index.play_cooldowns SET expires_at = now() - interval '1 second'"
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda _: _request(base_url, _path(str(uuid.uuid4())), cookie=COOKIE),
                range(16),
            )
        )
    assert all(status == 200 for status, _, _ in results), results
    assert sum(body["counted"] for _, _, body in results) == 1
    assert _sql(
        "SELECT play_count FROM plyr_index.track_metrics WHERE record_uri = %s",
        (RECORD_URI,),
    ) == (12,)

    lost_id = str(uuid.uuid4())
    target = _path(lost_id)
    with socket.create_connection(
        ("127.0.0.1", int(base_url.rsplit(":", 1)[1]))
    ) as sock:
        sock.sendall(
            f"POST {target} HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".encode()
        )
        time.sleep(0.1)
    status, _, lost_retry = _request(base_url, target)
    assert status == 200 and lost_retry["counted"] and lost_retry["play_count"] == 13
    assert lost_retry["dedup"]["status"] == "duplicate"

    _sql(
        "UPDATE plyr_index.track_policies SET visibility = 'private' WHERE record_uri = %s",
        (SECOND_URI,),
    )
    private_id = str(uuid.uuid4())
    assert _request(base_url, _path(private_id, SECOND_URI))[0] == 404
    assert _sql(
        "SELECT count(*) FROM plyr_index.play_receipts WHERE occurrence = %s",
        (private_id,),
    ) == (0,)
    assert _sql(
        "SELECT play_count FROM tracks WHERE atproto_record_uri = %s", (RECORD_URI,)
    ) == (7,)

    _sql(
        "UPDATE plyr_index.play_receipts SET accepted_at = now() - interval '10 years' WHERE occurrence = %s",
        (lost_id,),
    )
    assert _request(base_url, target)[2]["dedup"]["status"] == "duplicate"
    assert _sql("SELECT count(*) FROM plyr_index.play_receipts WHERE counted") == (6,)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda _: _request(base_url, _path(str(uuid.uuid4()))), range(16))
        )
    assert all(status == 200 and body["counted"] for status, _, body in results), (
        results
    )
    assert sorted(body["play_count"] for _, _, body in results) == list(range(14, 30))
    assert _sql(
        "SELECT play_count FROM plyr_index.track_metrics WHERE record_uri = %s",
        (RECORD_URI,),
    ) == (29,)

    listener = str(uuid.uuid4())
    explicit_id = str(uuid.uuid4())
    explicit_path = f"{_path(explicit_id)}&listener={listener}"
    status, headers, explicit = _request(base_url, explicit_path)
    assert status == 200 and explicit["counted"] and explicit["play_count"] == 30
    assert "set-cookie" not in headers
    for cookie in (None, COOKIE, "plyr_play_id=zyxwvutsrqponmlkjihgfe"):
        status, headers, same_listener = _request(
            base_url, f"{_path(str(uuid.uuid4()))}&listener={listener}", cookie=cookie
        )
        assert status == 200 and not same_listener["counted"]
        assert same_listener["play_count"] == 30
        assert same_listener["dedup"]["status"] == "suppressed"
        assert "set-cookie" not in headers
    status, headers, other_listener = _request(
        base_url, f"{_path(str(uuid.uuid4()))}&listener={uuid.uuid4()}"
    )
    assert (
        status == 200
        and other_listener["counted"]
        and other_listener["play_count"] == 31
    )
    assert "set-cookie" not in headers
    assert _request(base_url, _path(explicit_id))[2]["play_count"] == 30
    for suffix in ("&listener=invalid", f"&listener={listener}&listener={listener}"):
        assert _request(base_url, _path(str(uuid.uuid4())) + suffix)[0] == 400

    samples: list[float] = []
    for _ in range(20):
        started = time.perf_counter()
        assert _request(base_url, target)[0] == 200
        samples.append((time.perf_counter() - started) * 1000)
    samples.sort()
    print(
        f"play HTTP passed; duplicate receipt warm p50={samples[10]:.2f}ms p95={samples[18]:.2f}ms (20 requests)"
    )
    samples = []
    for _ in range(20):
        started = time.perf_counter()
        assert _request(base_url, _path(str(uuid.uuid4())))[2]["counted"]
        samples.append((time.perf_counter() - started) * 1000)
    samples.sort()
    print(
        f"new receipt warm p50={samples[10]:.2f}ms p95={samples[18]:.2f}ms (20 requests)"
    )

    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(lambda _: _request(base_url, _path(str(uuid.uuid4()))), range(100))
        )
    elapsed = time.perf_counter() - started
    assert all(status == 200 and body["counted"] for status, _, body in results)
    print(
        f"new receipts concurrency8: {100 / elapsed:.0f} requests/s (100 requests, pool4)"
    )


def main() -> None:
    _prepare_database()
    port = _unused_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "TRACK_COLLECTION_NSID": COLLECTION,
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
        "INDEX_MODE": "required",
        "DATABASE_URL": "postgresql://play_http_api:local-fixture-password@127.0.0.1:5435/zig_test",
        "DATABASE_ROLE": "play_http_api",
        "DATABASE_POOL_SIZE": "4",
    }
    with tempfile.TemporaryFile() as logs:
        process = subprocess.Popen(
            [ROOT / "zig-out/bin/plyr-backend"],
            cwd=ROOT,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=logs,
        )
        try:
            _wait_until_ready(base_url, process)
            _exercise(base_url)
        except BaseException:
            logs.seek(0)
            print(logs.read().decode())
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)


if __name__ == "__main__":
    main()

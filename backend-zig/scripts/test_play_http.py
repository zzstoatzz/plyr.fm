"""End-to-end sustained-play contract against disposable Postgres and Redis."""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import psycopg

ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = "postgresql://zig_test:zig_test@127.0.0.1:5435/zig_test"
REDIS_URL = "redis://127.0.0.1:6380/0"
COLLECTION = "fm.plyr.dev.track"
RECORD_URI = f"at://did:plc:artist/{COLLECTION}/play-http"


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
        connection.execute("DROP TABLE IF EXISTS share_link_events CASCADE")
        connection.execute("DROP TABLE IF EXISTS share_links CASCADE")
        connection.execute("DROP TABLE IF EXISTS tracks CASCADE")
        connection.execute("CREATE SCHEMA plyr_index")
        connection.execute(
            """
            CREATE TABLE tracks (
                id serial PRIMARY KEY,
                atproto_record_uri text UNIQUE NOT NULL,
                play_count integer NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE share_links (
                id serial PRIMARY KEY,
                code text UNIQUE NOT NULL,
                track_id integer NOT NULL REFERENCES tracks(id),
                creator_did text NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE share_link_events (
                id serial PRIMARY KEY,
                share_link_id integer NOT NULL REFERENCES share_links(id),
                visitor_did text,
                event_type text NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE plyr_index.track_records (
                record_uri text PRIMARY KEY,
                owner_did text NOT NULL,
                duration_seconds bigint,
                self_labels text[] NOT NULL DEFAULT '{}',
                deleted boolean NOT NULL DEFAULT false
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE plyr_index.account_availability (
                repo_did text PRIMARY KEY,
                available boolean NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE plyr_index.track_policies (
                record_uri text PRIMARY KEY,
                visibility text NOT NULL,
                operator_labels jsonb NOT NULL DEFAULT '[]',
                moderation_decision text
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE plyr_index.track_metrics (
                record_uri text PRIMARY KEY,
                play_count bigint NOT NULL CHECK (play_count >= 0),
                write_source text NOT NULL,
                observed_at_us bigint NOT NULL
            )
            """
        )
        track_id = connection.execute(
            "INSERT INTO tracks (atproto_record_uri, play_count) "
            "VALUES (%s, 7) RETURNING id",
            (RECORD_URI,),
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO share_links (code, track_id, creator_did) "
            "VALUES ('share123', %s, 'did:plc:creator')",
            (track_id,),
        )
        connection.execute(
            "INSERT INTO plyr_index.track_records "
            "(record_uri, owner_did, duration_seconds) "
            "VALUES (%s, 'did:plc:artist', 180)",
            (RECORD_URI,),
        )
        connection.execute(
            "INSERT INTO plyr_index.account_availability VALUES "
            "('did:plc:artist', true)"
        )
        connection.execute(
            "INSERT INTO plyr_index.track_policies (record_uri, visibility) "
            "VALUES (%s, 'public')",
            (RECORD_URI,),
        )
        connection.execute(
            "INSERT INTO plyr_index.track_metrics VALUES (%s, 7, 'test_fixture', 1)",
            (RECORD_URI,),
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
        response = urllib.request.urlopen(request, timeout=2)
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
            stderr = process.stderr.read().decode() if process.stderr else ""
            raise RuntimeError(f"server exited before readiness:\n{stderr}")
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.02)
    raise TimeoutError("Zig play API did not become ready")


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
        "DATABASE_URL": DATABASE_URL,
        "DOCKET_URL": REDIS_URL,
        "DATABASE_POOL_SIZE": "2",
    }
    process = subprocess.Popen(
        [ROOT / "zig-out/bin/plyr-backend"],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_until_ready(base_url, process)
        path = f"/v1/tracks/{_track_id(RECORD_URI)}/plays"
        status, headers, first = _request(base_url, path)
        assert status == 200
        assert first["counted"] is True and first["play_count"] == 8
        assert first["dedup"] == {"status": "claimed", "window_seconds": 180}
        cookie = headers["set-cookie"].split(";", 1)[0]
        assert cookie.startswith("plyr_play_id=")

        status, headers, duplicate = _request(base_url, path, cookie=cookie)
        assert status == 200 and "set-cookie" not in headers
        assert duplicate["counted"] is False and duplicate["play_count"] == 8
        assert duplicate["dedup"]["status"] == "duplicate"

        status, _, attributed = _request(base_url, f"{path}?ref=share123")
        assert status == 200
        assert attributed["counted"] is True and attributed["play_count"] == 9
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)

    with psycopg.connect(DATABASE_URL) as connection:
        counts = connection.execute(
            "SELECT m.play_count, t.play_count "
            "FROM plyr_index.track_metrics m "
            "JOIN tracks t ON t.atproto_record_uri = m.record_uri "
            "WHERE m.record_uri = %s",
            (RECORD_URI,),
        ).fetchone()
        events = connection.execute(
            "SELECT count(*) FROM share_link_events WHERE event_type = 'play'"
        ).fetchone()[0]
    assert counts == (9, 9)
    assert events == 1


if __name__ == "__main__":
    main()

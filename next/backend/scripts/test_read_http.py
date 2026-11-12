"""Exercise complete catalog read recovery against disposable local Postgres."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
from bench_http import HttpTarget, _unused_port, _wait_until_ready
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
ADMIN_URL = "postgresql://zig_test:zig_test@127.0.0.1:5435/zig_test"


def _request(target: HttpTarget, path: str) -> tuple[int, bytes]:
    connection = target.connect()
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def _prepare(database_url: str, database: str) -> None:
    with psycopg.connect(database_url) as connection:
        fixture = (ROOT / "scripts/composed_track_bench.sql").read_text()
        fixture = fixture.replace(
            "current_database() <> 'zig_bench'", f"current_database() <> '{database}'"
        )
        connection.execute(fixture)
        connection.execute("ALTER TABLE public.artists ADD COLUMN pds_url text")
        for prefix in (
            "0023",
            "0024",
            "0026",
            "0028",
            "0029",
            "0030",
            "0032",
            "0033",
            "0034",
        ):
            (migration,) = (ROOT / "migrations").glob(f"{prefix}_*.sql")
            connection.execute(migration.read_text())
        connection.execute(
            "INSERT INTO plyr_index.track_tag_records "
            "SELECT record_uri, record_cid, ARRAY['ambient'], true "
            "FROM plyr_index.track_records"
        )


def _pid(admin: Any, role: str) -> int:
    rows = admin.execute(
        "SELECT pid FROM pg_stat_activity WHERE usename = %s", (role,)
    ).fetchall()
    if len(rows) != 1:
        raise AssertionError(f"expected one API database connection, got {len(rows)}")
    return int(rows[0][0])


def main() -> None:
    suffix = uuid.uuid4().hex[:12]
    database = f"zig_read_recovery_{suffix}"
    role = f"zig_read_client_{suffix}"
    password = uuid.uuid4().hex
    parsed = urlsplit(ADMIN_URL)
    database_url = urlunsplit(parsed._replace(path=f"/{database}"))
    api_url = urlunsplit(
        parsed._replace(netloc=f"{role}:{password}@127.0.0.1:5435", path=f"/{database}")
    )
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        try:
            _prepare(database_url, database)
            admin.execute(
                sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(password)
                )
            )
            try:
                with psycopg.connect(database_url) as setup:
                    setup.execute(
                        sql.SQL("GRANT USAGE ON SCHEMA plyr_index TO {}").format(
                            sql.Identifier(role)
                        )
                    )
                    setup.execute(
                        sql.SQL(
                            "GRANT SELECT ON ALL TABLES IN SCHEMA plyr_index TO {}"
                        ).format(sql.Identifier(role))
                    )
                _exercise(admin, role, api_url)
            finally:
                with psycopg.connect(database_url) as cleanup:
                    cleanup.execute(
                        sql.SQL("DROP OWNED BY {}").format(sql.Identifier(role))
                    )
                admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
        finally:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database)
                )
            )


def _exercise(admin: Any, role: str, api_url: str) -> None:
    port = _unused_port()
    target = HttpTarget("http", "127.0.0.1", port)
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "INDEX_MODE": "required",
        "DATABASE_URL": api_url,
        "DATABASE_POOL_SIZE": "1",
        "TRACK_COLLECTION_NSID": "fm.plyr.dev.track",
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
    }
    binary = os.environ.get(
        "PLYR_READ_TEST_BINARY", str(ROOT / "zig-out/bin/plyr-backend")
    )
    with tempfile.TemporaryFile() as logs:
        process = subprocess.Popen([binary], env=environment, stdout=logs, stderr=logs)
        try:
            _wait_until_ready(port, process)
            status, first = _request(target, "/v1/tracks?limit=3")
            assert status == 200, (status, first)
            track_id = json.loads(first)["data"][0]["id"]
            paths = (
                "/v1/tracks?limit=3",
                "/v1/tracks?limit=3&tag=ambient",
                "/v1/tracks?limit=3&artist_did=did:plc:bench",
                f"/v1/tracks/{track_id}",
                "/v1/tags?limit=3",
                "/ready",
            )
            for path in paths:
                status, expected = _request(target, path)
                assert status == 200, (path, status, expected)
                old_pid = _pid(admin, role)
                assert admin.execute(
                    "SELECT pg_terminate_backend(%s)", (old_pid,)
                ).fetchone()[0]
                status, actual = _request(target, path)
                assert status == 200, (path, status, actual)
                assert actual == expected, path
                assert _pid(admin, role) != old_pid
            admin.execute(sql.SQL("ALTER ROLE {} NOLOGIN").format(sql.Identifier(role)))
            admin.execute("SELECT pg_terminate_backend(%s)", (_pid(admin, role),))
            began = time.monotonic()
            status, body = _request(target, "/v1/tracks?limit=3")
            assert status == 503, (status, body)
            assert time.monotonic() - began < 5, "failed read exceeded request timeout"
            print(
                "catalog reads recovered after termination; unavailable replacement returned 503"
            )
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()

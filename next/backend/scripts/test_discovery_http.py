"""Verify listener filtering through the real API on a disposable database."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from bench_http import HttpTarget, _unused_port, _wait_until_ready
from psycopg import sql
from test_read_http import ADMIN_URL, ROOT, _prepare, _request


def main() -> None:
    database = f"zig_discovery_{uuid.uuid4().hex[:12]}"
    database_url = urlunsplit(urlsplit(ADMIN_URL)._replace(path=f"/{database}"))
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        try:
            _prepare(database_url, database)
            exercise(database_url)
        finally:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database)
                )
            )


def exercise(database_url: str) -> None:
    port = _unused_port()
    target = HttpTarget("http", "127.0.0.1", port)
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "INDEX_MODE": "required",
        "DATABASE_URL": database_url,
        "DATABASE_POOL_SIZE": "1",
        "TRACK_COLLECTION_NSID": "fm.plyr.dev.track",
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
    }
    binary = os.environ.get(
        "PLYR_DISCOVERY_TEST_BINARY", str(ROOT / "zig-out/bin/plyr-backend")
    )
    with (
        tempfile.TemporaryFile() as logs,
        psycopg.connect(database_url, autocommit=True) as db,
    ):
        process = subprocess.Popen([binary], env=environment, stdout=logs, stderr=logs)
        try:
            _wait_until_ready(port, process)

            def get(path: str) -> dict:
                status, body = _request(target, path)
                assert status == 200, (path, status, body)
                return json.loads(body)

            db.execute(
                "INSERT INTO plyr_index.account_label_policies VALUES ('did:plc:bench', '[\"ai\"]', 1, (extract(epoch FROM statement_timestamp()) * 1000000)::bigint + 3600000000)"
            )
            assert get("/v1/tracks?limit=3")["data"] == [], (
                "account label hides untagged discovery"
            )
            visible = get("/v1/tracks?limit=3&hidden_tag=")
            assert len(visible["data"]) == 3 and visible["has_more"]
            track = visible["data"][0]
            assert track["moderation"]["account_labels"] == ["ai"]
            assert track["moderation"]["operator_labels"] == []
            assert track["sources"]["account_labels"] == "moderation_service"
            assert len(get("/v1/tracks?artist_did=did:plc:bench&limit=3")["data"]) == 3
            assert get(f"/v1/tracks/{track['id']}")["moderation"]["account_labels"] == [
                "ai"
            ]
            db.execute("UPDATE plyr_index.account_label_policies SET expires_at_us = 1")
            expired = get("/v1/tracks?limit=3")
            assert len(expired["data"]) == 3
            assert expired["data"][0]["moderation"]["account_labels"] == []
            db.execute("DELETE FROM plyr_index.account_label_policies")
            db.execute(
                "UPDATE plyr_index.track_tag_records SET tags=ARRAY['suno'] WHERE record_uri LIKE '%/track-100' OR record_uri LIKE '%/track-98'"
            )
            first = get("/v1/tracks?limit=3")
            assert len(first["data"]) == 3 and first["has_more"]
            assert all(
                item["record"]["rkey"] not in {"track-100", "track-98"}
                for item in first["data"]
            )
            second = get(f"/v1/tracks?limit=3&cursor={quote(first['next_cursor'])}")
            assert len(second["data"]) == 3
            assert not (
                {item["id"] for item in first["data"]}
                & {item["id"] for item in second["data"]}
            )
            status, _ = _request(
                target, f"/v1/tracks?hidden_tag=&cursor={quote(first['next_cursor'])}"
            )
            assert status == 400, "preference changes invalidate discovery cursors"
            assert (
                get("/v1/tracks?hidden_tag=&limit=1")["data"][0]["record"]["rkey"]
                == "track-100"
            )
            duplicates = "&".join(["hidden_tag=ai"] * 11)
            assert len(get(f"/v1/tracks?limit=3&{duplicates}")["data"]) == 3
            too_many = "&".join(f"hidden_tag=tag-{index}" for index in range(11))
            assert _request(target, f"/v1/tracks?{too_many}")[0] == 400
            print(
                "account labels, tag defaults, show-all, artist/detail visibility and cursor filtering passed"
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

"""Verify queue suggestions through the real API on a disposable database."""

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

TRACK = "at://did:plc:bench/fm.plyr.dev.track/track-{}"


def main() -> None:
    database = f"zig_suggestions_{uuid.uuid4().hex[:12]}"
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

            def numbers(query: str) -> list[int]:
                status, body = _request(target, f"/v1/suggestions/tracks?{query}")
                assert status == 200, (query, status, body)
                payload = json.loads(body)
                assert payload["object"] == "track_suggestions"
                return [
                    int(item["record"]["rkey"].split("-")[1])
                    for item in payload["data"]
                ]

            def seeds(*values: int) -> str:
                return "&".join(f"seed={quote(TRACK.format(n))}" for n in values)

            # track N is liked by likers 1..N, so every track from 50 up shares
            # all fifty of track-50's likers; the more liked ones come first.
            assert numbers(f"{seeds(50)}&limit=5") == [100, 99, 98, 97, 96]
            # what the caller already has never comes back
            assert numbers(
                f"{seeds(50)}&exclude={quote(TRACK.format(100))}&limit=3"
            ) == [99, 98, 97]
            # track-5 sits in the playlist and album with tracks 1-20, so those
            # outrank tracks that only share its likers
            assert numbers(f"{seeds(5)}&limit=5") == [20, 19, 18, 17, 16]
            # several seeds: none of them is suggested back
            assert not {50, 60} & set(numbers(f"{seeds(50, 60)}&limit=10"))
            # moderation still applies
            db.execute(
                "UPDATE plyr_index.track_policies SET moderation_decision = 'exclude' WHERE record_uri = %s",
                (TRACK.format(99),),
            )
            assert numbers(f"{seeds(50)}&limit=3") == [100, 98, 97]
            # unknown seeds suggest nothing rather than failing
            assert (
                numbers(f"seed={quote('at://did:plc:nobody/fm.plyr.dev.track/x')}")
                == []
            )
            for bad in (
                "",
                "limit=3",
                "seed=https://example.com",
                f"{seeds(50)}&limit=25",
            ):
                status, _ = _request(target, f"/v1/suggestions/tracks?{bad}")
                assert status == 400, bad
            print(
                "suggestions rank by shared likers and lists, exclude, moderate and validate"
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

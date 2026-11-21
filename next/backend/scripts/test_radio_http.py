"""Verify radio through the real API on a disposable database."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
from bench_http import HttpTarget, _unused_port, _wait_until_ready
from psycopg import sql
from test_read_http import ADMIN_URL, ROOT, _prepare, _request

TRACK = "at://did:plc:bench/fm.plyr.dev.track/track-{}"
OTHER = "at://did:plc:radio{0}/fm.plyr.dev.track/song-{0}-{1}"


def main() -> None:
    database = f"zig_radio_{uuid.uuid4().hex[:12]}"
    database_url = urlunsplit(urlsplit(ADMIN_URL)._replace(path=f"/{database}"))
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        try:
            _prepare(database_url, database)
            _prepare_radio(database_url)
            exercise(database_url)
        finally:
            admin.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                    sql.Identifier(database)
                )
            )


def _prepare_radio(database_url: str) -> None:
    """Twelve more artists with three tracks each, beside the fixture's one
    prolific artist, so airtime caps and artist spacing have room to work."""
    with psycopg.connect(database_url) as connection:
        connection.execute("CREATE SCHEMA IF NOT EXISTS plyr_playback")
        (migration,) = (ROOT / "migrations").glob("0053_*.sql")
        connection.execute(migration.read_text())
        for artist in range(1, 13):
            did = f"did:plc:radio{artist}"
            _copy(
                connection,
                "account_availability",
                "repo_did",
                "did:plc:bench",
                {"repo_did": did},
            )
            _copy(
                connection,
                "actor_identities",
                "did",
                "did:plc:bench",
                {
                    "did": did,
                    "handle": f"radio{artist}.test",
                    "display_name": f"Radio Artist {artist}",
                },
            )
            for song in range(1, 4):
                uri = OTHER.format(artist, song)
                source = TRACK.format(1)
                (created,) = connection.execute(
                    "SELECT record_created_at_us FROM plyr_index.track_records WHERE record_uri = %s",
                    (source,),
                ).fetchone()
                _copy(
                    connection,
                    "track_records",
                    "record_uri",
                    source,
                    {
                        "record_uri": uri,
                        "owner_did": did,
                        "rkey": f"song-{artist}-{song}",
                        "title": f"Radio Song {artist}-{song}",
                        "duration_seconds": 200 + song,
                        "record_created_at_us": created + artist * 10 + song,
                    },
                )
                _copy(
                    connection,
                    "track_delivery_origins",
                    "record_uri",
                    source,
                    {
                        "record_uri": uri,
                        "origin_url": f"https://r2.example/{artist}-{song}.flac",
                    },
                )
                _copy(
                    connection,
                    "track_tag_records",
                    "record_uri",
                    source,
                    {"record_uri": uri},
                )


def _copy(
    connection: psycopg.Connection, table: str, key: str, source: str, changes: dict
) -> None:
    """Insert a copy of one row with some columns replaced."""
    connection.execute(
        sql.SQL(
            "INSERT INTO plyr_index.{table} SELECT (jsonb_populate_record("
            "NULL::plyr_index.{table}, to_jsonb(t) || %s::jsonb)).* "
            "FROM plyr_index.{table} AS t WHERE {key} = %s"
        ).format(table=sql.Identifier(table), key=sql.Identifier(key)),
        (json.dumps(changes), source),
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
        "DATABASE_POOL_SIZE": "2",
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

            def get(path: str, expected: int = 200) -> dict:
                status, body = _request(target, path)
                assert status == expected, (path, status, body)
                return json.loads(body)

            lineup = get("/radio/stations")
            assert lineup == get("/xrpc/fm.plyr.dev.unspecced.getRadioStations")
            assert lineup["default_slug"] == "loved"
            assert [s["slug"] for s in lineup["stations"]] == [
                "loved",
                "fresh",
                "deep-cuts",
                "slop",
                "firehose",
            ]
            firehose = lineup["stations"][-1]
            assert firehose["source_url"] == "https://relay-eval.waow.tech/sonify"

            state = get("/radio/state?catalog_only=true")
            assert state["station_slug"] == "loved" and state["station"] == "loved"
            rotation = state["rotation"]
            assert rotation, state
            assert state["current"] is not None
            assert state["current"] == rotation[state["current_index"]]
            assert 0 <= state["progress_seconds"] < state["current"]["duration"]
            assert state["loop_duration_seconds"] == sum(
                t["duration"] for t in rotation
            )
            assert len(state["up_next"]) == min(4, len(rotation) - 1)
            assert state["live"] is None
            for item in rotation:
                # the verified copy is preferred over what the record names
                assert item["stream_url"].startswith("https://r2.example/"), item
                assert item["duration"] > 0 and item["id"] > 0
                assert item["atproto_record_uri"].startswith("at://")
                assert item["liked"] is False
                assert "ambient" in item["tags"]
            # no artist airs twice within three entries
            dids = [t["artist_did"] for t in rotation]
            for index, did in enumerate(dids):
                assert did not in dids[max(0, index - 3) : index], dids
            # the prolific artist stops near the airtime budget
            bench = [t for t in rotation if t["artist_did"] == "did:plc:bench"]
            assert sum(t["duration"] for t in bench) < 20 * 60 + 200, len(bench)

            # pinned: the same loop on every request, and in the database
            again = get("/radio/state?catalog_only=true")
            assert [t["atproto_record_uri"] for t in again["rotation"]] == [
                t["atproto_record_uri"] for t in rotation
            ]
            (pins,) = db.execute(
                "SELECT count(*) FROM plyr_playback.radio_rotations WHERE station = 'loved'"
            ).fetchone()
            assert pins == 1
            xrpc = get("/xrpc/fm.plyr.dev.unspecced.getRadioState?catalogOnly=true")
            assert [t["atproto_record_uri"] for t in xrpc["rotation"]] == [
                t["atproto_record_uri"] for t in rotation
            ]

            # a track taken down after the pin leaves the loop at once
            gone = rotation[0]["atproto_record_uri"]
            db.execute(
                "UPDATE plyr_index.track_policies SET moderation_decision = 'exclude' "
                "WHERE record_uri = %s",
                (gone,),
            )
            db.execute(
                "INSERT INTO plyr_index.track_policies (record_uri, moderation_decision, "
                "moderation_write_source, moderation_observed_at_us) "
                "VALUES (%s, 'exclude', 'moderation_log', 1) ON CONFLICT DO NOTHING",
                (gone,),
            )
            after = get("/radio/state?catalog_only=true")
            assert gone not in [t["atproto_record_uri"] for t in after["rotation"]]
            assert len(after["rotation"]) == len(rotation) - 1

            # slop is only the hidden-tag tracks, and loved never has them
            for song in range(1, 4):
                db.execute(
                    "UPDATE plyr_index.track_tag_records SET tags = ARRAY['ai'] "
                    "WHERE record_uri = %s",
                    (OTHER.format(5, song),),
                )
            slop = get("/radio/state?station=slop&catalog_only=true")
            assert slop["station"] == "slop"
            assert {t["artist_did"] for t in slop["rotation"]} == {"did:plc:radio5"}

            # fresh leans newest; firehose has no publisher here and plays nothing
            fresh = get(
                "/xrpc/fm.plyr.dev.unspecced.getRadioState?station=fresh&catalogOnly=true&limit=5"
            )
            assert 0 < len(fresh["rotation"]) <= 5
            empty = get("/radio/state?station=firehose&catalog_only=true")
            assert empty["rotation"] == [] and empty["current"] is None
            assert empty["current_started_at"] is None

            get("/radio/state?station=jazz", 404)
            get("/xrpc/fm.plyr.dev.unspecced.getRadioState?station=jazz", 400)
            for bad in ("limit=0", "limit=76", "catalog_only=maybe"):
                get(f"/radio/state?{bad}", 400)
            connection = target.connect()
            try:
                connection.request("POST", "/radio/state")
                assert connection.getresponse().status == 405
            finally:
                connection.close()
            print(
                "radio pins a fair rotation per period, moderates, filters stations and validates"
            )
        except BaseException:
            logs.seek(0)
            print(logs.read().decode(errors="replace")[-4000:])
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()

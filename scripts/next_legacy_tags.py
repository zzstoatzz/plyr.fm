# /// script
# requires-python = ">=3.12"
# dependencies = ["psycopg[binary]>=3.2,<4"]
# ///
"""Export public legacy tag annotations and audit/import them into isolated Next."""

import argparse
import asyncio
import hashlib
import json
import os
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

SOURCE_SQL = """
SELECT t.atproto_record_uri, t.atproto_record_cid, t.id,
       array_agg(g.name ORDER BY g.name)
FROM tracks t JOIN track_tags tt ON tt.track_id=t.id JOIN tags g ON g.id=tt.tag_id
WHERE t.visibility <> 'private' AND coalesce(t.support_gate->>'type','') <> 'owner'
  AND NOT coalesce((t.extra->>'tags_pds_synced')::boolean,false)
  AND t.atproto_record_uri IS NOT NULL AND t.atproto_record_cid IS NOT NULL
GROUP BY t.id, t.atproto_record_uri, t.atproto_record_cid
ORDER BY t.atproto_record_uri LIMIT 10001
"""
INPUT_SQL = """
WITH input AS (
  SELECT * FROM jsonb_to_recordset(%s::jsonb)
  AS x(record_uri text, observed_record_cid text, source_track_id bigint, tags text[])
)
"""
AUDIT_SQL = (
    INPUT_SQL
    + """
SELECT i.record_uri, CASE
  WHEN tr.record_uri IS NULL OR tr.deleted THEN 'missing_record'
  WHEN tr.record_cid <> i.observed_record_cid THEN 'cid_mismatch'
  WHEN tt.record_uri IS NULL OR tt.record_cid <> tr.record_cid THEN 'unverified_tags'
  WHEN tt.tags_present THEN 'canonical_tags'
  ELSE 'eligible' END AS reason
FROM input i LEFT JOIN plyr_index.track_records tr ON tr.record_uri=i.record_uri
LEFT JOIN plyr_index.track_tag_records tt ON tt.record_uri=tr.record_uri
"""
)
LOCK_SQL = (
    INPUT_SQL
    + """
SELECT tr.record_uri FROM input i
JOIN plyr_index.track_records tr ON tr.record_uri=i.record_uri
JOIN plyr_index.track_tag_records tt ON tt.record_uri=tr.record_uri
WHERE NOT tr.deleted AND tr.record_cid=i.observed_record_cid
  AND tt.record_cid=tr.record_cid AND NOT tt.tags_present
FOR SHARE OF tr, tt
"""
)
IMPORT_SQL = (
    INPUT_SQL
    + """
INSERT INTO plyr_index.legacy_track_tags
  (record_uri,observed_record_cid,tag,source,source_track_id,source_observed_at)
SELECT i.record_uri,i.observed_record_cid,tag,'legacy-plyr',i.source_track_id,%s::timestamptz
FROM input i
JOIN plyr_index.track_records tr ON tr.record_uri=i.record_uri
JOIN plyr_index.track_tag_records tt ON tt.record_uri=tr.record_uri
CROSS JOIN LATERAL unnest(plyr_index.normalize_track_tags(i.tags)) AS tag
WHERE NOT tr.deleted AND tr.record_cid=i.observed_record_cid
  AND tt.record_cid=tr.record_cid AND NOT tt.tags_present
ON CONFLICT (record_uri,observed_record_cid,tag) DO NOTHING
RETURNING record_uri
"""
)


def fingerprint(connection: psycopg.AsyncConnection[Any]) -> str:
    identity = f"{connection.info.host}/{connection.info.dbname}"
    return hashlib.sha256(identity.encode()).hexdigest()


def read_manifest(path: Path) -> dict[str, Any]:
    if path.stat().st_size > 16_000_000:
        raise ValueError("export exceeds 16MB")
    value = json.loads(path.read_text())
    if (
        not isinstance(value, dict)
        or value.get("version") != 1
        or value.get("source") != "legacy-plyr"
    ):
        raise ValueError("invalid export format")
    observed = datetime.fromisoformat(value["source_observed_at"])
    if observed.tzinfo is None:
        raise ValueError("export needs an explicit observation timezone")
    rows = value.get("tracks")
    if not isinstance(rows, list) or len(rows) > 10_000:
        raise ValueError("export exceeds 10000 tracks")
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid track annotation")
        uri, cid, tags, source_id = (
            row.get(key)
            for key in ("record_uri", "observed_record_cid", "tags", "source_track_id")
        )
        if (
            not isinstance(uri, str)
            or not uri.startswith("at://did:")
            or "/fm.plyr.track/" not in uri
            or len(uri) > 4096
            or uri in seen
        ):
            raise ValueError("invalid or duplicate source URI")
        if not isinstance(cid, str) or not 30 <= len(cid) <= 200:
            raise ValueError("invalid source CID")
        if (
            not isinstance(source_id, int)
            or isinstance(source_id, bool)
            or source_id < 1
        ):
            raise ValueError("invalid legacy track ID")
        if (
            not isinstance(tags, list)
            or not 1 <= len(tags) <= 20
            or any(
                not isinstance(tag, str)
                or not 1 <= len(tag.encode()) <= 50
                or "\x00" in tag
                for tag in tags
            )
        ):
            raise ValueError("invalid legacy tag set")
        seen.add(uri)
    return value


def write_manifest(path: Path, value: dict[str, Any]) -> None:
    with path.open("x") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")


async def export_tags(output: Path) -> None:
    url = os.environ["PLYR_TAG_SOURCE_DATABASE_URL"]
    async with await psycopg.AsyncConnection.connect(url) as connection:
        async with connection.transaction():
            await connection.execute(
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
            )
            await connection.execute("SET LOCAL statement_timeout='15s'")
            cursor = await connection.execute(SOURCE_SQL)
            records = await cursor.fetchall()
            if len(records) > 10_000:
                raise ValueError("source exceeds 10000 tracks")
            tracks = [
                dict(
                    record_uri=uri,
                    observed_record_cid=cid,
                    source_track_id=identifier,
                    tags=tags,
                )
                for uri, cid, identifier, tags in records
            ]
            value = {
                "version": 1,
                "source": "legacy-plyr",
                "source_fingerprint": fingerprint(connection),
                "source_observed_at": datetime.now(UTC).isoformat(),
                "tracks": tracks,
            }
    await asyncio.to_thread(write_manifest, output, value)
    await asyncio.to_thread(read_manifest, output)
    print(
        json.dumps(
            {
                "exported_tracks": len(tracks),
                "tag_memberships": sum(len(row["tags"]) for row in tracks),
            }
        )
    )


async def import_tags(
    path: Path, target_database: str, target_host: str, apply: bool
) -> dict[str, Any]:
    manifest = await asyncio.to_thread(read_manifest, path)
    url = os.environ["PLYR_TAG_TARGET_DATABASE_URL"]
    report: Counter[str] = Counter()
    async with await psycopg.AsyncConnection.connect(
        url, autocommit=True
    ) as connection:
        if (
            connection.info.dbname != target_database
            or connection.info.host != target_host
        ):
            raise ValueError("target does not match explicit host and database")
        cursor = await connection.execute(
            "SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname=current_database()"
        )
        if await cursor.fetchone() not in (("plyr-zig-next",), ("plyr-zig-test",)):
            raise ValueError("target database has no plyr-zig marker")
        if fingerprint(connection) == manifest.get("source_fingerprint"):
            raise ValueError("source and target databases must differ")
        for start in range(0, len(manifest["tracks"]), 100):
            batch = manifest["tracks"][start : start + 100]
            async with connection.transaction():
                await connection.execute("SET LOCAL statement_timeout='15s'")
                await connection.execute("SET LOCAL lock_timeout='5s'")
                if apply:
                    await connection.execute(LOCK_SQL, (Jsonb(batch),))
                else:
                    await connection.execute("SET TRANSACTION READ ONLY")
                cursor = await connection.execute(AUDIT_SQL, (Jsonb(batch),))
                report.update(reason for _, reason in await cursor.fetchall())
                if apply:
                    cursor = await connection.execute(
                        IMPORT_SQL, (Jsonb(batch), manifest["source_observed_at"])
                    )
                    report["inserted_tag_memberships"] += len(await cursor.fetchall())
    result = {"apply": apply, "tracks": len(manifest["tracks"]), "counts": dict(report)}
    print(json.dumps(result, sort_keys=True))
    return result


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--output", type=Path, required=True)
    for name in ("audit", "import"):
        command = commands.add_parser(name)
        command.add_argument("path", type=Path)
        command.add_argument("--target-database", required=True)
        command.add_argument("--target-host", required=True)
    args = parser.parse_args()
    if args.command == "export":
        await export_tags(args.output)
    else:
        await import_tags(
            args.path, args.target_database, args.target_host, args.command == "import"
        )


if __name__ == "__main__":
    asyncio.run(main())

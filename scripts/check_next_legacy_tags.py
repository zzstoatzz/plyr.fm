# /// script
# requires-python = ">=3.12"
# dependencies = ["psycopg[binary]>=3.2,<4"]
# ///
"""Exercise the legacy import against two disposable local PostgreSQL databases."""

import asyncio
import json
import os
import tempfile
from pathlib import Path

import psycopg

from next_legacy_tags import export_tags, fingerprint, import_tags, read_manifest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "postgresql://zig_test:zig_test@127.0.0.1:5435/zig_tag_source"
TARGET = "postgresql://zig_test:zig_test@127.0.0.1:5435/zig_tag_annotations"
CID = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


async def main() -> None:
    async with await psycopg.AsyncConnection.connect(SOURCE) as source:
        await source.execute("DROP TABLE IF EXISTS track_tags,tags,tracks")
        await source.execute(
            "CREATE TABLE tracks(id bigint PRIMARY KEY,atproto_record_uri text,atproto_record_cid text,visibility text,support_gate jsonb,extra jsonb)"
        )
        await source.execute("CREATE TABLE tags(id bigint PRIMARY KEY,name text)")
        await source.execute("CREATE TABLE track_tags(track_id bigint,tag_id bigint)")
        for identifier in range(1, 9):
            await source.execute(
                "INSERT INTO tracks VALUES(%s,%s,%s,%s,%s::jsonb,%s::jsonb)",
                (
                    identifier,
                    f"at://did:plc:fixture/fm.plyr.track/{identifier}",
                    CID,
                    "private" if identifier == 2 else "public",
                    json.dumps({"type": "owner"}) if identifier == 3 else None,
                    json.dumps({"tags_pds_synced": identifier == 4}),
                ),
            )
            await source.execute("INSERT INTO track_tags VALUES(%s,1)", (identifier,))
        await source.execute("INSERT INTO tags VALUES(1,' Ambient ')")
    async with await psycopg.AsyncConnection.connect(TARGET) as target:
        await target.execute(
            "COMMENT ON DATABASE zig_tag_annotations IS 'plyr-zig-test'"
        )
        await target.execute("DROP SCHEMA IF EXISTS plyr_index CASCADE")
        await target.execute("CREATE SCHEMA plyr_index")
        await target.execute(
            "CREATE TABLE plyr_index.track_records(record_uri text PRIMARY KEY,record_cid text,deleted boolean NOT NULL)"
        )
        migration = (
            ROOT / "next/backend/migrations/0032_add_verified_track_tags.sql"
        ).read_text()
        await target.execute(migration)
        await target.execute(
            "ALTER TABLE plyr_index.track_tag_records ADD COLUMN IF NOT EXISTS tags_present boolean NOT NULL DEFAULT false"
        )
        await target.execute(
            (
                ROOT / "next/backend/migrations/0033_add_legacy_tag_annotations.sql"
            ).read_text()
        )
        for identifier in (1, 6, 7, 8):
            cid = CID + "different" if identifier == 6 else CID
            uri = f"at://did:plc:fixture/fm.plyr.track/{identifier}"
            await target.execute(
                "INSERT INTO plyr_index.track_records VALUES(%s,%s,false)", (uri, cid)
            )
            if identifier != 8:
                await target.execute(
                    "INSERT INTO plyr_index.track_tag_records VALUES(%s,%s,'{}',%s)",
                    (uri, cid, identifier == 7),
                )
    os.environ["PLYR_TAG_SOURCE_DATABASE_URL"] = SOURCE
    os.environ["PLYR_TAG_TARGET_DATABASE_URL"] = TARGET
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "export.json"
        await export_tags(path)
        manifest = read_manifest(path)
        assert len(manifest["tracks"]) == 5
        audit = await import_tags(path, "zig_tag_annotations", "127.0.0.1", False)
        assert audit["counts"] == {
            "eligible": 1,
            "missing_record": 1,
            "cid_mismatch": 1,
            "canonical_tags": 1,
            "unverified_tags": 1,
        }
        first = await import_tags(path, "zig_tag_annotations", "127.0.0.1", True)
        assert first["counts"]["inserted_tag_memberships"] == 1
        second = await import_tags(path, "zig_tag_annotations", "127.0.0.1", True)
        assert second["counts"]["inserted_tag_memberships"] == 0
        async with await psycopg.AsyncConnection.connect(TARGET) as target:
            cursor = await target.execute(
                "SELECT tag,source FROM plyr_index.legacy_track_tags"
            )
            assert await cursor.fetchall() == [("ambient", "legacy-plyr")]
            cursor = await target.execute(
                "SELECT count(*) FROM plyr_index.track_records"
            )
            assert await cursor.fetchone() == (4,)
            manifest["source_fingerprint"] = fingerprint(target)
        same = Path(directory) / "same.json"
        same.write_text(json.dumps(manifest))
        try:
            await import_tags(same, "zig_tag_annotations", "127.0.0.1", True)
            raise AssertionError("same-source import accepted")
        except ValueError as error:
            assert "must differ" in str(error)
        try:
            await import_tags(path, "wrong-database", "127.0.0.1", True)
            raise AssertionError("wrong target accepted")
        except ValueError as error:
            assert "explicit host and database" in str(error)
        manifest["tracks"][0]["tags"] = ["x" * 51]
        invalid = Path(directory) / "invalid.json"
        invalid.write_text(json.dumps(manifest))
        try:
            read_manifest(invalid)
            raise AssertionError("oversized tag accepted")
        except ValueError as error:
            assert "legacy tag set" in str(error)
    print(
        "legacy tag export/import: policy, CID, absent/empty, unknown, idempotency and target guards passed"
    )


if __name__ == "__main__":
    asyncio.run(main())

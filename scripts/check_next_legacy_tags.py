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
        await source.execute("INSERT INTO tags VALUES(1,' - Ambient - ')")
        await source.execute("INSERT INTO tags VALUES(2,%s)", ("ⱥ" * 25,))
        await source.execute("INSERT INTO track_tags VALUES(1,2)")
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
        cursor = await target.execute(
            "SELECT plyr_index.normalize_track_tags(ARRAY[' - ambient - ']), plyr_index.normalize_track_tags(ARRAY['a  b'])"
        )
        before = await cursor.fetchone()
        assert before == ([" ambient "], ["a b"]), before
        cursor = await target.execute(
            "SELECT plyr_index.normalize_track_tags(ARRAY[%s])", ("\\synth",)
        )
        assert await cursor.fetchone() == (["\\synth"],)
        repair_uri = "at://did:plc:fixture/fm.plyr.track/repair"
        await target.execute(
            "INSERT INTO plyr_index.track_records VALUES(%s,%s,false)",
            (repair_uri, CID),
        )
        await target.execute(
            "INSERT INTO plyr_index.track_tag_records VALUES(%s,%s,ARRAY[' ambient ','a  b','---'],true)",
            (repair_uri, CID),
        )
        await target.execute(
            "INSERT INTO plyr_index.legacy_track_tags(record_uri,observed_record_cid,tag,source_track_id,source_observed_at,imported_at) VALUES (%s,%s,'ambient',10,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),(%s,%s,' - ambient - ',11,'2026-01-03T00:00:00Z','2026-01-04T00:00:00Z'),(%s,%s,' ambient ',12,'2026-01-02T00:00:00Z','2026-01-05T00:00:00Z'),(%s,%s,'---',13,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),(%s,%s,' - ambient - ',14,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            (
                repair_uri,
                CID,
                repair_uri,
                CID,
                repair_uri,
                CID,
                repair_uri,
                CID,
                repair_uri,
                CID + "stale",
            ),
        )
        migration = (
            ROOT / "next/backend/migrations/0034_normalize_derived_tags.sql"
        ).read_text()
        await target.execute(migration)
        cursor = await target.execute(
            "SELECT record_cid,tags,tags_present FROM plyr_index.track_tag_records WHERE record_uri=%s",
            (repair_uri,),
        )
        assert await cursor.fetchone() == (CID, ["a b", "ambient"], True)
        cursor = await target.execute(
            "SELECT observed_record_cid,tag,source_track_id,source_observed_at::text,imported_at::text FROM plyr_index.legacy_track_tags ORDER BY observed_record_cid"
        )
        repaired = await cursor.fetchall()
        assert [(row[0], row[1], row[2]) for row in repaired] == [
            (CID, "ambient", 11),
            (CID + "stale", "ambient", 14),
        ]
        assert repaired[0][3].startswith("2026-01-03") and repaired[0][4].startswith(
            "2026-01-04"
        )
        await target.execute(migration)
        cursor = await target.execute(
            "SELECT observed_record_cid,tag,source_track_id,source_observed_at::text,imported_at::text FROM plyr_index.legacy_track_tags ORDER BY observed_record_cid"
        )
        assert await cursor.fetchall() == repaired
        for raw, expected in [
            ([" - ambient - "], ["ambient"]),
            (["-- - AMBIENT - --"], ["ambient"]),
            (["a\t  b"], ["a b"]),
            (["hip-hop"], ["hip-hop"]),
            (["---", "", None], []),
            (["Ⱥ" * 25], ["ⱥ" * 25]),
            (["ambient", " - AMBIENT - "], ["ambient"]),
        ]:
            cursor = await target.execute(
                "SELECT plyr_index.normalize_track_tags(%s::text[]),plyr_index.normalize_track_tags(plyr_index.normalize_track_tags(%s::text[]))",
                (raw, raw),
            )
            assert await cursor.fetchone() == (expected, expected)
        await target.execute("DELETE FROM plyr_index.legacy_track_tags")
        await target.execute(
            "DELETE FROM plyr_index.track_records WHERE record_uri=%s", (repair_uri,)
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
        assert first["counts"]["inserted_tag_memberships"] == 2
        second = await import_tags(path, "zig_tag_annotations", "127.0.0.1", True)
        assert second["counts"]["inserted_tag_memberships"] == 0
        async with await psycopg.AsyncConnection.connect(TARGET) as target:
            cursor = await target.execute(
                "SELECT tag,source FROM plyr_index.legacy_track_tags ORDER BY tag"
            )
            assert await cursor.fetchall() == [
                ("ambient", "legacy-plyr"),
                ("ⱥ" * 25, "legacy-plyr"),
            ]
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
        manifest["tracks"][0]["tags"] = ["x" * 201]
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

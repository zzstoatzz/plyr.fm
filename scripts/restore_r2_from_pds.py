#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx", "boto3", "sqlalchemy[asyncio]", "asyncpg", "pydantic-settings"]
# ///
"""restore R2 audio objects from the artist's PDS blob.

For tracks we mirrored to both R2 and the artist's PDS, the PDS copy is the one
that survived #1732 — staged-upload cleanup deleted R2 objects out from under
published tracks. The blob is the same bytes the artist uploaded, so copying it
back restores the CDN path without touching a single database row.

Tracks with no `pds_blob_cid` are reported and skipped: there is nothing to
restore from, and inventing a substitute would be worse than a dead link.

usage:
    export ADMIN_DATABASE_URL=...
    export ADMIN_AWS_ACCESS_KEY_ID=... ADMIN_AWS_SECRET_ACCESS_KEY=...
    export ADMIN_R2_ENDPOINT_URL=... ADMIN_R2_BUCKET=audio-prod
    uv run scripts/restore_r2_from_pds.py --dry-run
    uv run scripts/restore_r2_from_pds.py
"""

import argparse
import asyncio
import sys

import boto3
import httpx
from botocore.config import Config
from botocore.exceptions import ClientError
from pydantic_settings import BaseSettings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

CANDIDATES = text("""
    SELECT t.id, t.file_id, t.file_type, t.pds_blob_cid, t.artist_did,
           a.handle, a.pds_url
    FROM tracks t
    JOIN artists a ON a.did = t.artist_did
    WHERE t.pds_blob_cid IS NOT NULL
      AND t.visibility IN ('public', 'supporters')
      AND a.deactivated = false
    ORDER BY t.id
""")


class AdminSettings(BaseSettings):
    database_url: str
    aws_access_key_id: str
    aws_secret_access_key: str
    r2_endpoint_url: str
    r2_bucket: str

    class Config:
        env_prefix = "ADMIN_"


def blob_url(pds_url: str, did: str, cid: str) -> str:
    return f"{pds_url}/xrpc/com.atproto.sync.getBlob?did={did}&cid={cid}"


async def main(dry_run: bool, only_ids: set[int] | None) -> int:
    settings = AdminSettings()  # type: ignore[call-arg]
    s3 = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        config=Config(
            request_checksum_calculation="WHEN_REQUIRED",
            response_checksum_validation="WHEN_REQUIRED",
        ),
    )

    engine = create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        rows = list((await conn.execute(CANDIDATES)).mappings())
    await engine.dispose()

    if only_ids:
        rows = [r for r in rows if r["id"] in only_ids]

    missing, restored, failed = [], [], []
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as http:
        for row in rows:
            key = f"audio/{row['file_id']}.{row['file_type']}"
            try:
                s3.head_object(Bucket=settings.r2_bucket, Key=key)
                continue  # R2 already has it
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
                    raise

            missing.append(row)
            label = f"track {row['id']} ({row['handle']}) -> {key}"
            if dry_run:
                print(f"  would restore {label}")
                continue

            try:
                resp = await http.get(
                    blob_url(row["pds_url"], row["artist_did"], row["pds_blob_cid"])
                )
                resp.raise_for_status()
                s3.put_object(
                    Bucket=settings.r2_bucket,
                    Key=key,
                    Body=resp.content,
                    CacheControl="public, max-age=31536000, immutable",
                )
            except Exception as exc:  # noqa: BLE001 — report, don't abort the batch
                failed.append((row, exc))
                print(f"  FAILED {label}: {exc}")
            else:
                restored.append(row)
                print(f"  restored {label} ({len(resp.content):,} bytes)")

    print(f"\n{len(rows)} mirrored tracks checked, {len(missing)} missing from R2")
    if not dry_run:
        print(f"{len(restored)} restored, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--ids", help="comma-separated track ids to limit the run to", default=""
    )
    args = parser.parse_args()
    ids = {int(i) for i in args.ids.split(",") if i.strip()} or None
    sys.exit(asyncio.run(main(args.dry_run, ids)))

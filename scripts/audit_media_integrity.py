#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = ["boto3", "sqlalchemy[asyncio]", "asyncpg", "pydantic-settings"]
# ///
"""report every row whose media object is missing from R2.

Two incidents have now been found by a user rather than by us: the 2026-06-30
dead-audioUrl ingest, whose retrospective left "nothing alerts on a track whose
r2_url object is missing" as an open follow-up, and #1732, where staged cleanup
deleted published tracks' audio and 20 tracks sat broken until one was noticed
playing on stream.

This is that follow-up. It answers one question — does the object each row
points at actually exist — and says nothing about why it doesn't. Exit code 1
when anything is missing, so it can run on a schedule and page.

usage:
    export ADMIN_DATABASE_URL=...
    export ADMIN_AWS_ACCESS_KEY_ID=... ADMIN_AWS_SECRET_ACCESS_KEY=...
    export ADMIN_R2_ENDPOINT_URL=... ADMIN_R2_BUCKET=audio-prod
    export ADMIN_R2_IMAGE_BUCKET=images-prod
    uv run scripts/audit_media_integrity.py
    uv run scripts/audit_media_integrity.py --audio-only
"""

import argparse
import asyncio
import sys
from collections.abc import Iterator

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from pydantic_settings import BaseSettings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# only rows a listener can actually reach — a private track has no R2 object by
# design, and a deactivated artist's catalogue is already hidden.
AUDIO_ROWS = text("""
    SELECT t.id, a.handle, t.file_id AS media_id, t.file_type AS ext,
           t.pds_blob_cid IS NOT NULL AS recoverable
    FROM tracks t
    JOIN artists a ON a.did = t.artist_did
    WHERE t.visibility IN ('public', 'supporters')
      AND t.support_gate IS NULL
      AND a.deactivated = false
    ORDER BY t.id
""")

IMAGE_ROWS = text("""
    SELECT 'track' AS kind, t.id, a.handle, t.image_id AS media_id
    FROM tracks t JOIN artists a ON a.did = t.artist_did
    WHERE t.image_id IS NOT NULL AND a.deactivated = false
    UNION ALL
    SELECT 'album', al.id, a.handle, al.image_id
    FROM albums al JOIN artists a ON a.did = al.artist_did
    WHERE al.image_id IS NOT NULL
""")

IMAGE_EXTENSIONS = ("jpg", "jpeg", "png", "webp", "gif")


class AdminSettings(BaseSettings):
    database_url: str
    aws_access_key_id: str
    aws_secret_access_key: str
    r2_endpoint_url: str
    r2_bucket: str
    r2_image_bucket: str = ""

    class Config:
        env_prefix = "ADMIN_"


def exists(s3, bucket: str, candidates: Iterator[str]) -> bool:
    for key in candidates:
        try:
            s3.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") not in ("404", "NoSuchKey"):
                raise
    return False


async def main(audio_only: bool) -> int:
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
        audio = list((await conn.execute(AUDIO_ROWS)).mappings())
        images = [] if audio_only else list((await conn.execute(IMAGE_ROWS)).mappings())
    await engine.dispose()

    missing_audio = [
        row
        for row in audio
        if not exists(
            s3, settings.r2_bucket, iter([f"audio/{row['media_id']}.{row['ext']}"])
        )
    ]
    for row in missing_audio:
        hint = "recoverable from PDS" if row["recoverable"] else "NO PDS COPY"
        print(f"  audio  track {row['id']:>5}  {row['handle']:<32} {hint}")

    missing_images = []
    if not audio_only and settings.r2_image_bucket:
        for row in images:
            candidates = (f"images/{row['media_id']}.{ext}" for ext in IMAGE_EXTENSIONS)
            if not exists(s3, settings.r2_image_bucket, candidates):
                missing_images.append(row)
                print(f"  image  {row['kind']} {row['id']:>5}  {row['handle']}")

    print(
        f"\n{len(audio)} audio rows checked, {len(missing_audio)} missing"
        + (
            ""
            if audio_only
            else f"; {len(images)} image rows checked, {len(missing_images)} missing"
        )
    )
    if unrecoverable := [r for r in missing_audio if not r["recoverable"]]:
        print(f"{len(unrecoverable)} of the missing audio rows have no PDS copy")
    return 1 if (missing_audio or missing_images) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio-only", action="store_true")
    sys.exit(asyncio.run(main(parser.parse_args().audio_only)))

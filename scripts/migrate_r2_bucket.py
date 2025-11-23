#!/usr/bin/env -S uv run --script --quiet
"""One-time migration script to copy audio files from old 'relay' bucket to new 'audio-prod' bucket.

This script:
1. Fetches all tracks from the production database
2. Identifies tracks with R2 URLs pointing to the old bucket
3. Copies files from old bucket to new bucket
4. Updates the r2_url column in the database

Usage:
    uv run python scripts/migrate_r2_bucket.py
"""

import asyncio
import logging

import boto3
from botocore.config import Config
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.config import settings
from backend.models.track import Track

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Old and new bucket configuration
OLD_BUCKET = "relay"
OLD_PUBLIC_URL = "https://pub-841ec0f5a7854eaab01292d44aca4820.r2.dev"
NEW_BUCKET = "audio-prod"
NEW_PUBLIC_URL = "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev"
R2_ENDPOINT_URL = "https://8feb33b5fb57ce2bc093bc6f4141f40a.r2.cloudflarestorage.com"


async def main():
    """Run the R2 bucket migration."""
    logger.info("Starting R2 bucket migration")

    # Create R2 client
    if not all(
        [settings.storage.aws_access_key_id, settings.storage.aws_secret_access_key]
    ):
        logger.error("AWS credentials not found in environment")
        logger.error(
            "Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables"
        )
        return

    r2_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=settings.storage.aws_access_key_id,
        aws_secret_access_key=settings.storage.aws_secret_access_key,
        config=Config(
            request_checksum_calculation="WHEN_REQUIRED",
            response_checksum_validation="WHEN_REQUIRED",
        ),
    )

    # Create database session
    engine = create_async_engine(settings.database.url)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with async_session() as session:
        # Fetch all tracks with old bucket URLs
        result = await session.execute(
            select(Track).where(Track.r2_url.like(f"{OLD_PUBLIC_URL}%"))
        )
        tracks = result.scalars().all()

        if not tracks:
            logger.info("No tracks found with old bucket URLs")
            return

        logger.info(f"Found {len(tracks)} tracks to migrate")

        migrated_count = 0
        failed_count = 0

        for track in tracks:
            try:
                # Extract the S3 key from the old URL
                # Format: https://pub-841ec0f5a7854eaab01292d44aca4820.r2.dev/audio/FILE_ID.EXT
                old_key = track.r2_url.replace(f"{OLD_PUBLIC_URL}/", "")
                new_key = old_key  # Same key structure in new bucket

                logger.info(f"Migrating track {track.id}: {track.title}")
                logger.info(f"  Old: {OLD_BUCKET}/{old_key}")
                logger.info(f"  New: {NEW_BUCKET}/{new_key}")

                # Check if file exists in old bucket
                try:
                    r2_client.head_object(Bucket=OLD_BUCKET, Key=old_key)
                except r2_client.exceptions.ClientError as e:
                    if e.response["Error"]["Code"] == "404":
                        logger.error(f"  File not found in old bucket: {old_key}")
                        failed_count += 1
                        continue
                    raise

                # Check if file already exists in new bucket
                try:
                    r2_client.head_object(Bucket=NEW_BUCKET, Key=new_key)
                    logger.info("  File already exists in new bucket, skipping copy")
                except r2_client.exceptions.ClientError as e:
                    if e.response["Error"]["Code"] == "404":
                        # Copy file from old bucket to new bucket
                        logger.info("  Copying file to new bucket...")
                        r2_client.copy_object(
                            Bucket=NEW_BUCKET,
                            Key=new_key,
                            CopySource={"Bucket": OLD_BUCKET, "Key": old_key},
                        )
                        logger.info("  File copied successfully")
                    else:
                        raise

                # Update database with new URL
                new_url = f"{NEW_PUBLIC_URL}/{new_key}"
                await session.execute(
                    update(Track).where(Track.id == track.id).values(r2_url=new_url)
                )

                logger.info(f"  Updated database: {new_url}")
                migrated_count += 1

            except Exception as e:
                logger.error(f"  Failed to migrate track {track.id}: {e}")
                failed_count += 1

        # Commit all database changes
        await session.commit()

        logger.info("")
        logger.info("=" * 60)
        logger.info("Migration complete!")
        logger.info(f"  Migrated: {migrated_count}")
        logger.info(f"  Failed: {failed_count}")
        logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())

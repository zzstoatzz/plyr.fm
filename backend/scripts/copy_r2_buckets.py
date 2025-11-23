#!/usr/bin/env -S uv run --script --quiet
"""Copy R2 bucket data from old buckets to new buckets."""

from pathlib import Path

import boto3
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[1]


class R2Settings(BaseSettings):
    """R2 credentials from environment."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    aws_access_key_id: str = Field(validation_alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(validation_alias="AWS_SECRET_ACCESS_KEY")
    r2_endpoint_url: str = Field(validation_alias="R2_ENDPOINT_URL")


def get_s3_client():
    """Create S3 client for R2."""
    settings = R2Settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name="auto",
    )


def copy_bucket(s3_client, source_bucket: str, dest_bucket: str):
    """Copy all objects from source bucket to destination bucket."""
    print(f"\n{'=' * 60}")
    print(f"Copying from '{source_bucket}' to '{dest_bucket}'")
    print(f"{'=' * 60}\n")

    # List all objects in source bucket
    paginator = s3_client.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=source_bucket)

    total_objects = 0
    copied_objects = 0

    for page in pages:
        if "Contents" not in page:
            print(f"No objects found in {source_bucket}")
            return

        for obj in page["Contents"]:
            key = obj["Key"]
            total_objects += 1

            try:
                # Copy object
                copy_source = {"Bucket": source_bucket, "Key": key}
                s3_client.copy_object(
                    CopySource=copy_source, Bucket=dest_bucket, Key=key
                )
                copied_objects += 1
                print(f"✓ Copied: {key} ({obj['Size']} bytes)")
            except Exception as e:
                print(f"✗ Failed to copy {key}: {e}")

    print(f"\n{'=' * 60}")
    print(f"Summary: {copied_objects}/{total_objects} objects copied successfully")
    print(f"{'=' * 60}\n")


def main():
    """Copy data from old buckets to new buckets."""
    s3_client = get_s3_client()

    # Define bucket mappings
    bucket_mappings = [
        ("relay", "audio-prod"),
        ("relay-stg", "audio-staging"),
    ]

    print("\n🚀 Starting R2 bucket copy operation\n")

    for source, dest in bucket_mappings:
        try:
            copy_bucket(s3_client, source, dest)
        except Exception as e:
            print(f"✗ Error copying {source} -> {dest}: {e}")
            continue

    print("✅ All copy operations completed!\n")


if __name__ == "__main__":
    main()

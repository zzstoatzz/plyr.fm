#!/usr/bin/env python3
"""migrate images from audio-* buckets to images-* buckets."""

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


def migrate_images(env: str):
    """migrate images for a specific environment.

    args:
        env: environment name (dev, staging, prod)
    """
    settings = R2Settings()

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name="auto",
    )

    source_bucket = f"audio-{env}"
    dest_bucket = f"images-{env}"
    prefix = "images/"

    print(f"\nmigrating {env}:")
    print(f"  source: {source_bucket}/{prefix}")
    print(f"  dest: {dest_bucket}/")

    # list all objects in source bucket with images/ prefix
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=source_bucket, Prefix=prefix)

    copied_count = 0
    for page in pages:
        if "Contents" not in page:
            continue

        for obj in page["Contents"]:
            source_key = obj["Key"]
            # remove images/ prefix for destination
            dest_key = source_key.replace("images/", "", 1)

            # copy object
            copy_source = {"Bucket": source_bucket, "Key": source_key}
            s3.copy_object(
                CopySource=copy_source,
                Bucket=dest_bucket,
                Key=dest_key,
            )

            copied_count += 1
            print(f"  ✓ copied {source_key} -> {dest_key}")

    print(f"  total: {copied_count} files")


def main():
    """migrate images for all environments."""
    for env in ["dev", "staging", "prod"]:
        migrate_images(env)

    print("\n✅ migration complete!")


if __name__ == "__main__":
    main()

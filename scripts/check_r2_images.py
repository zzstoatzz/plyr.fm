#!/usr/bin/env python3
"""check what image files exist in R2 for specific image_ids."""

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
    r2_bucket: str = Field(validation_alias="R2_BUCKET")


def main():
    """check R2 for image files."""
    settings = R2Settings()

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name="auto",
    )

    # image_ids from production database
    image_ids = [
        "04c14a2c0e36fd8d",  # webhook
        "9bd4ac1111a1fb4e",  # geese cover
        "a25fb714b1a05ebf",  # floating (GIF)
    ]

    # check prod bucket (relay) not dev
    prod_bucket = "relay"
    print(f"checking bucket: {prod_bucket}\n")

    for image_id in image_ids:
        print(f"searching for {image_id}:")
        response = s3.list_objects_v2(
            Bucket=settings.r2_bucket,
            Prefix=f"images/{image_id}",
        )

        if "Contents" in response:
            for obj in response["Contents"]:
                key = obj["Key"]
                size = obj["Size"]
                print(f"  ✓ found: {key} ({size} bytes)")
        else:
            print("  ✗ not found in images/")


if __name__ == "__main__":
    main()

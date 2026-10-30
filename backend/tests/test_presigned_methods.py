"""Real SigV4 signing binds private media URLs to the request method."""

from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

import aioboto3
import boto3
import pytest
from botocore.config import Config

from backend.storage.r2 import R2Storage


async def test_head_presign_matches_real_sdk_head_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "botocore.auth.get_current_datetime", lambda: datetime(2026, 1, 1, tzinfo=UTC)
    )
    storage = object.__new__(R2Storage)
    storage.async_session = aioboto3.Session()
    storage.private_audio_bucket_name = "test-private"
    storage.presigned_url_expiry = 3600
    storage._s3_kwargs = {
        "endpoint_url": "https://storage.example.test",
        "aws_access_key_id": "test-access",
        "aws_secret_access_key": "test-secret",
        "region_name": "us-east-1",
    }
    signed_head = await storage.generate_presigned_url(
        "test-audio", "mp3", http_method="HEAD"
    )
    signed_get = await storage.generate_presigned_url("test-audio", "mp3")
    client = boto3.client(
        "s3", **storage._s3_kwargs, config=Config(signature_version="s3v4")
    )
    expected = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": "test-private", "Key": "audio/test-audio.mp3"},
        ExpiresIn=3600,
        HttpMethod="HEAD",
    )
    assert signed_head == expected
    assert (
        parse_qs(urlsplit(signed_head).query)["X-Amz-Signature"]
        != parse_qs(urlsplit(signed_get).query)["X-Amz-Signature"]
    )

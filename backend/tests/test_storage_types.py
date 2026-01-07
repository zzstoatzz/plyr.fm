"""test storage type hints accept BytesIO.

regression test for: https://github.com/zzstoatzz/plyr.fm/pull/736
beartype was rejecting BytesIO for BinaryIO type hint in R2Storage.save()
"""

from io import BytesIO
from unittest.mock import AsyncMock, patch

from backend.storage.r2 import R2Storage


async def test_r2_save_accepts_bytesio():
    """R2Storage.save() should accept BytesIO objects.

    BytesIO is the standard way to create in-memory binary streams,
    and is used throughout the codebase for image uploads.

    This test verifies that the type hint on save() is compatible
    with BytesIO, which beartype validates at runtime.
    """
    # create a minimal image-like BytesIO
    image_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # fake PNG header
    file_obj = BytesIO(image_data)

    # mock the R2 client internals
    with (
        patch.object(R2Storage, "__init__", lambda self: None),
        patch("backend.storage.r2.hash_file_chunked", return_value="abc123def456"),
    ):
        storage = R2Storage()
        storage.async_session = AsyncMock()
        storage.image_bucket_name = "test-images"
        storage.audio_bucket_name = "test-audio"

        # mock the async context manager for S3 client
        mock_client = AsyncMock()
        mock_client.upload_fileobj = AsyncMock()

        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cm.__aexit__ = AsyncMock(return_value=None)
        storage.async_session.client = lambda *args, **kwargs: mock_cm
        storage.endpoint_url = "https://test.r2.dev"
        storage.aws_access_key_id = "test"
        storage.aws_secret_access_key = "test"

        # this should NOT raise a beartype error
        # before the fix: BeartypeCallHintParamViolation
        file_id = await storage.save(file_obj, "test.png")

        assert file_id == "abc123def456"[:16]
        mock_client.upload_fileobj.assert_called_once()

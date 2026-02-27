"""test storage types, protocol conformance, and bug regressions."""

from io import BytesIO
from unittest.mock import AsyncMock, patch

from backend.storage.protocol import StorageProtocol
from backend.storage.r2 import R2Storage

# module-level ref to the mock S3 client for assertions in tests
_last_mock_client: AsyncMock | None = None


def _mock_r2_storage() -> R2Storage:
    """create an R2Storage instance with mocked internals."""
    global _last_mock_client

    with patch.object(R2Storage, "__init__", lambda self: None):
        s = R2Storage()
        s.async_session = AsyncMock()
        s.image_bucket_name = "test-images"
        s.audio_bucket_name = "test-audio"
        s.private_audio_bucket_name = "test-private"
        s.public_audio_bucket_url = "https://audio.test.dev"
        s.public_image_bucket_url = "https://images.test.dev"
        s.presigned_url_expiry = 3600
        s.endpoint_url = "https://test.r2.dev"
        s.aws_access_key_id = "test"
        s.aws_secret_access_key = "test"

        mock_client = AsyncMock()
        mock_client.upload_fileobj = AsyncMock()
        mock_client.head_object = AsyncMock()
        mock_client.delete_object = AsyncMock()
        _last_mock_client = mock_client

        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cm.__aexit__ = AsyncMock(return_value=None)
        s.async_session.client = lambda *args, **kwargs: mock_cm

        return s


async def test_r2_save_accepts_bytesio():
    """R2Storage.save() should accept BytesIO objects.

    regression test for: https://github.com/zzstoatzz/plyr.fm/pull/736
    """
    image_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    file_obj = BytesIO(image_data)

    with patch("backend.storage.r2.hash_file_chunked", return_value="abc123def456"):
        s = _mock_r2_storage()
        file_id = await s.save(file_obj, "test.png")

        assert file_id == "abc123def456"[:16]
        assert _last_mock_client is not None
        _last_mock_client.upload_fileobj.assert_called_once()


def test_r2_storage_conforms_to_protocol():
    """R2Storage should satisfy StorageProtocol."""
    assert isinstance(_mock_r2_storage(), StorageProtocol)


def test_build_image_url():
    """build_image_url constructs correct public URL."""
    s = _mock_r2_storage()

    assert (
        s.build_image_url("abc123", ".png")
        == "https://images.test.dev/images/abc123.png"
    )
    assert (
        s.build_image_url("abc123", "webp")
        == "https://images.test.dev/images/abc123.webp"
    )


def test_image_delete_key_includes_prefix():
    """regression: image delete must use images/ prefix in key.

    before fix, delete used key f"{file_id}.{format}" (missing images/ prefix),
    so HEAD check would 404 and images were never actually deleted from R2.
    """
    import inspect

    source = inspect.getsource(R2Storage.delete)
    # the image format loop should use f"images/{file_id}.{image_format.value}"
    assert 'f"images/{file_id}.{image_format.value}"' in source


async def test_save_thumbnail():
    """save_thumbnail uploads WebP to correct key."""
    s = _mock_r2_storage()
    thumb_data = b"RIFF\x00\x00\x00\x00WEBP"

    url = await s.save_thumbnail(thumb_data, "abc123")

    assert url == "https://images.test.dev/images/abc123_thumb.webp"
    assert _last_mock_client is not None
    _last_mock_client.upload_fileobj.assert_called_once()

    # verify the key and content type
    call_kwargs = _last_mock_client.upload_fileobj.call_args
    assert call_kwargs[0][1] == "test-images"  # bucket
    assert call_kwargs[0][2] == "images/abc123_thumb.webp"  # key
    assert call_kwargs[1]["ExtraArgs"]["ContentType"] == "image/webp"

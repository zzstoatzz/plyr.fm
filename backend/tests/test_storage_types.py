"""test storage types, protocol conformance, and bug regressions."""

from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

from backend.storage.protocol import StorageProtocol
from backend.storage.r2 import R2Storage


def _mock_r2_storage() -> tuple[R2Storage, AsyncMock]:
    """create an R2Storage with mocked internals. returns (storage, mock_s3_client)."""
    with patch.object(R2Storage, "__init__", lambda self: None):
        s = R2Storage()
        s.async_session = AsyncMock()
        s.image_bucket_name = "test-images"
        s.audio_bucket_name = "test-audio"
        s.private_audio_bucket_name = "test-private"
        s.public_audio_bucket_url = "https://audio.test.dev"
        s.public_image_bucket_url = "https://images.test.dev"
        s.presigned_url_expiry = 3600
        s._s3_kwargs = {
            "endpoint_url": "https://test.r2.dev",
            "aws_access_key_id": "test",
            "aws_secret_access_key": "test",
        }

        mock_client = AsyncMock()
        mock_client.upload_fileobj = AsyncMock()
        mock_client.head_object = AsyncMock()
        mock_client.delete_object = AsyncMock()

        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cm.__aexit__ = AsyncMock(return_value=None)
        s.async_session.client = lambda *args, **kwargs: mock_cm

        return s, mock_client


async def test_r2_save_accepts_bytesio():
    """R2Storage.save() should accept BytesIO objects.

    regression test for: https://github.com/zzstoatzz/plyr.fm/pull/736
    """
    image_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    file_obj = BytesIO(image_data)

    with patch("backend.storage.r2.hash_file_chunked", return_value="abc123def456"):
        s, mock_client = _mock_r2_storage()
        file_id = await s.save(file_obj, "test.png")

        assert file_id == "abc123def456"[:16]
        mock_client.upload_fileobj.assert_called_once()


def test_r2_storage_conforms_to_protocol():
    """R2Storage should satisfy StorageProtocol."""
    s, _ = _mock_r2_storage()
    assert isinstance(s, StorageProtocol)


def test_build_image_url():
    """build_image_url constructs correct public URL."""
    s, _ = _mock_r2_storage()

    assert (
        s.build_image_url("abc123", ".png")
        == "https://images.test.dev/images/abc123.png"
    )
    assert (
        s.build_image_url("abc123", "webp")
        == "https://images.test.dev/images/abc123.webp"
    )


async def test_image_delete_uses_correct_key_prefix():
    """regression: image delete must use images/ prefix in key.

    before fix, delete used key f"{file_id}.{format}" (missing images/ prefix),
    so HEAD check would 404 and images were never actually deleted from R2.
    """
    s, mock_client = _mock_r2_storage()

    # mock db_session to return refcount=1 (safe to delete)
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one.return_value = 1
    mock_db.execute = AsyncMock(return_value=mock_result)

    mock_db_cm = AsyncMock()
    mock_db_cm.__aenter__ = AsyncMock(return_value=mock_db)
    mock_db_cm.__aexit__ = AsyncMock(return_value=None)

    with patch("backend.storage.r2.db_session", return_value=mock_db_cm):
        await s.delete("abc123")

    # verify head_object was called with images/ prefix
    head_calls = mock_client.head_object.call_args_list
    assert len(head_calls) > 0
    image_keys = [
        c.kwargs.get("Key", c[1].get("Key")) for c in head_calls if "images/" in str(c)
    ]
    assert all(k.startswith("images/") for k in image_keys)


async def test_save_thumbnail():
    """save_thumbnail uploads WebP to correct key."""
    s, mock_client = _mock_r2_storage()
    thumb_data = b"RIFF\x00\x00\x00\x00WEBP"

    url = await s.save_thumbnail(thumb_data, "abc123")

    assert url == "https://images.test.dev/images/abc123_thumb.webp"
    mock_client.upload_fileobj.assert_called_once()

    # verify the key and content type
    call_kwargs = mock_client.upload_fileobj.call_args
    assert call_kwargs[0][1] == "test-images"  # bucket
    assert call_kwargs[0][2] == "images/abc123_thumb.webp"  # key
    assert call_kwargs[1]["ExtraArgs"]["ContentType"] == "image/webp"

"""test storage types, protocol conformance, and bug regressions."""

from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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


# module-level so pytest.mark.parametrize can reference them and ruff doesn't
# flag the class attribute as a mutable default.
_AUDIO_CASES = [
    # (upload filename, file_type as stored in DB, expected R2 key)
    ("song.mp3", "mp3", "audio/abc123def4567890.mp3"),
    ("song.wav", "wav", "audio/abc123def4567890.wav"),
    ("song.m4a", "m4a", "audio/abc123def4567890.m4a"),
    ("song.flac", "flac", "audio/abc123def4567890.flac"),
    ("song.aiff", "aiff", "audio/abc123def4567890.aiff"),
    # the critical alias case — Ableton's default export
    ("song.aif", "aif", "audio/abc123def4567890.aif"),
    # uppercase variant — the staging path lowercases at the boundary
    ("song.AIF", "aif", "audio/abc123def4567890.aif"),
    ("song.webm", "webm", "audio/abc123def4567890.webm"),
    ("song.ogg", "ogg", "audio/abc123def4567890.ogg"),
]

_IMAGE_CASES = [
    ("cover.jpg", "jpg", "images/abc123def4567890.jpg"),
    # the critical alias case — #1202 broke when these diverged
    ("cover.jpeg", "jpeg", "images/abc123def4567890.jpeg"),
    ("cover.JPEG", "jpeg", "images/abc123def4567890.jpeg"),
    ("cover.png", "png", "images/abc123def4567890.png"),
    ("cover.webp", "webp", "images/abc123def4567890.webp"),
    ("cover.gif", "gif", "images/abc123def4567890.gif"),
]


class TestAudioSaveReadRoundtrip:
    """the fix that closes the bug class: for every supported audio extension
    (and every alias), the key produced by `save()` is the same key reached
    by `stream_file_data`, `head_file`, and `get_url`. would have caught:

    - #797 (`.aif` burnout): save wrote `.aif`, DB had `aiff`, URL 404'd
    - #1202 (`.jpeg` images): save wrote `.jpeg`, URL builder said `.jpg`
    - woody.fm 2026-05-16: save wrote `.aif`, readers normalized to `.aiff`
    """

    @pytest.mark.parametrize(("filename", "file_type", "expected_key"), _AUDIO_CASES)
    async def test_save_then_read_lands_on_same_key(
        self, filename: str, file_type: str, expected_key: str
    ) -> None:
        s, mock_client = _mock_r2_storage()
        file_obj = BytesIO(b"\x00" * 1024)

        with patch(
            "backend.storage.r2.hash_file_chunked", return_value="abc123def4567890"
        ):
            await s.save(file_obj, filename)

        # 1. save wrote to expected_key
        upload_call = mock_client.upload_fileobj.call_args
        actual_save_key = upload_call.kwargs.get("Key") or upload_call.args[2]
        assert actual_save_key == expected_key, (
            f"save() wrote to {actual_save_key!r}, expected {expected_key!r}"
        )

        # 2. reader paths all reach the same key
        mock_client.head_object.return_value = {"ContentLength": 1024}
        mock_client.get_object.return_value = {"Body": AsyncMock()}

        # head_file
        mock_client.head_object.reset_mock()
        await s.head_file("abc123def4567890", file_type)
        head_call = mock_client.head_object.call_args
        assert head_call.kwargs.get("Key") == expected_key

        # get_url with explicit extension
        mock_client.head_object.reset_mock()
        await s.get_url(
            "abc123def4567890", file_type="audio", extension=file_type
        )
        get_url_call = mock_client.head_object.call_args
        assert get_url_call.kwargs.get("Key") == expected_key

    @pytest.mark.parametrize(
        ("filename", "file_type"),
        [(case[0], case[1]) for case in _AUDIO_CASES],
    )
    async def test_delete_targets_exact_save_key(
        self, filename: str, file_type: str
    ) -> None:
        """`delete(file_id, file_type)` must HEAD and DELETE the same key
        save() wrote. woody.fm 2026-05-16 showed this drifting for `.aif`."""
        s, mock_client = _mock_r2_storage()
        file_obj = BytesIO(b"\x00" * 1024)

        with patch(
            "backend.storage.r2.hash_file_chunked", return_value="abc123def4567890"
        ):
            await s.save(file_obj, filename)

        save_key = mock_client.upload_fileobj.call_args.kwargs.get("Key")
        assert save_key is not None

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = 1  # refcount: safe to delete
        mock_db.execute = AsyncMock(return_value=mock_result)
        mock_db_cm = AsyncMock()
        mock_db_cm.__aenter__ = AsyncMock(return_value=mock_db)
        mock_db_cm.__aexit__ = AsyncMock(return_value=None)

        mock_client.head_object.reset_mock()
        mock_client.delete_object.reset_mock()
        mock_client.head_object.return_value = {}

        with patch("backend.storage.r2.db_session", return_value=mock_db_cm):
            await s.delete("abc123def4567890", file_type=file_type)

        head_keys = [c.kwargs.get("Key") for c in mock_client.head_object.call_args_list]
        delete_keys = [
            c.kwargs.get("Key") for c in mock_client.delete_object.call_args_list
        ]
        assert save_key in head_keys, f"delete didn't HEAD save key {save_key!r}"
        assert save_key in delete_keys, f"delete didn't DELETE save key {save_key!r}"


class TestImageSaveReadRoundtrip:
    """same guarantee for image surfaces — closes #1202."""

    @pytest.mark.parametrize(("filename", "ext", "expected_key"), _IMAGE_CASES)
    async def test_save_then_build_url_match(
        self, filename: str, ext: str, expected_key: str
    ) -> None:
        s, mock_client = _mock_r2_storage()
        file_obj = BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)

        with patch(
            "backend.storage.r2.hash_file_chunked", return_value="abc123def4567890"
        ):
            await s.save(file_obj, filename)

        save_key = mock_client.upload_fileobj.call_args.kwargs.get("Key")
        assert save_key == expected_key

        # build_image_url constructs a URL pointing at the same key
        url = s.build_image_url("abc123def4567890", ext)
        assert url.endswith(expected_key), (
            f"url {url!r} doesn't end with save key {expected_key!r}"
        )

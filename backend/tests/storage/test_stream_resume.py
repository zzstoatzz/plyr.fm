"""a GET body that stalls mid-transfer resumes from the last delivered byte."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from botocore.exceptions import ReadTimeoutError

from backend.storage.r2 import STREAM_MAX_RESUMES, R2Storage

DATA = b"abcdefghij" * 10


class _Body:
    def __init__(self, data: bytes, stall_after: int | None) -> None:
        self._data = data
        self._stall_after = stall_after

    async def iter_chunks(self, chunk_size: int) -> AsyncIterator[bytes]:
        sent = 0
        for i in range(0, len(self._data), chunk_size):
            if self._stall_after is not None and sent >= self._stall_after:
                raise ReadTimeoutError(endpoint_url="https://r2.test/obj")
            chunk = self._data[i : i + chunk_size]
            sent += len(chunk)
            yield chunk


@pytest.fixture
def storage() -> R2Storage:
    with patch.object(R2Storage, "__init__", lambda self: None):
        instance = R2Storage()
    instance.audio_bucket_name = "audio-test"
    instance.private_audio_bucket_name = "audio-private-test"
    return instance


def _install(storage: R2Storage, stalls: list[int | None]) -> MagicMock:
    client = MagicMock()
    client.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})

    async def get_object(**kwargs: str) -> dict:
        start = (
            int(kwargs["Range"].split("=")[1].rstrip("-")) if "Range" in kwargs else 0
        )
        return {"ETag": '"v1"', "Body": _Body(DATA[start:], stalls.pop(0))}

    client.get_object = AsyncMock(side_effect=get_object)

    @asynccontextmanager
    async def _client(**_: object):
        yield client

    storage._s3_client = _client  # type: ignore[method-assign]
    return client


async def _read(storage: R2Storage) -> bytes:
    out = b""
    async for chunk in storage.stream_file_data(
        "abc123", "flac", chunk_size=10, private=True
    ):
        out += chunk
    return out


async def test_stalled_stream_resumes_with_pinned_range(storage: R2Storage) -> None:
    client = _install(storage, [30, 20, None])

    assert await _read(storage) == DATA

    calls = [c.kwargs for c in client.get_object.await_args_list]
    assert "Range" not in calls[0]
    assert calls[1]["Range"] == "bytes=30-"
    assert calls[2]["Range"] == "bytes=50-"
    assert all(c["IfMatch"] == '"v1"' for c in calls[1:])


async def test_gives_up_after_max_resumes(storage: R2Storage) -> None:
    _install(storage, [10] * (STREAM_MAX_RESUMES + 1))

    with pytest.raises(ReadTimeoutError):
        await _read(storage)

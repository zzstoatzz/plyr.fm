"""the write half of the jetstream echo signal.

every record plyr writes in its own namespace must emit a "pds record write"
log, because the ingest-blackout alert is defined as "writes happened but zero
`jetstream dispatched` logs followed" (#1739). if the write log disappears or
stops matching plyr's namespace, the alert goes permanently silent.
"""

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal.atproto.client import _log_own_record_write
from backend.config import settings


@pytest.fixture
def redis() -> Iterator[MagicMock]:
    client = MagicMock()
    client.set = AsyncMock()
    with patch(
        "backend._internal.atproto.client.get_async_redis_client",
        return_value=client,
    ):
        yield client


def _own(collection_suffix: str) -> str:
    return f"{settings.atproto.app_namespace}.{collection_suffix}"


async def test_own_namespace_create_emits(redis: MagicMock) -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        await _log_own_record_write(
            "com.atproto.repo.createRecord",
            {"collection": _own("track"), "repo": "did:plc:abc"},
        )
    info.assert_called_once()
    assert info.call_args.kwargs["collection"] == _own("track")
    assert info.call_args.kwargs["operation"] == "create"


async def test_own_namespace_delete_emits(redis: MagicMock) -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        await _log_own_record_write(
            "com.atproto.repo.deleteRecord",
            {"collection": _own("like"), "repo": "did:plc:abc"},
        )
    assert info.call_args.kwargs["operation"] == "delete"


async def test_foreign_namespace_is_silent(redis: MagicMock) -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        await _log_own_record_write(
            "com.atproto.repo.createRecord",
            {"collection": "app.bsky.feed.post", "repo": "did:plc:abc"},
        )
    info.assert_not_called()


async def test_non_write_endpoint_is_silent(redis: MagicMock) -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        await _log_own_record_write(
            "com.atproto.repo.getRecord",
            {"collection": _own("track")},
        )
    info.assert_not_called()


async def test_missing_payload_is_silent(redis: MagicMock) -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        await _log_own_record_write("com.atproto.repo.createRecord", None)
    info.assert_not_called()


async def test_own_namespace_write_stamps_redis(redis: MagicMock) -> None:
    """the consumer rotates hosts off this stamp, not off a quiet timer."""
    with patch("backend._internal.atproto.client.logfire.info"):
        await _log_own_record_write(
            "com.atproto.repo.createRecord",
            {"collection": _own("like"), "repo": "did:plc:abc"},
        )
    redis.set.assert_awaited_once()
    key, value = redis.set.call_args.args
    assert key == settings.jetstream.last_write_key
    assert float(value) > 0


async def test_foreign_namespace_does_not_stamp(redis: MagicMock) -> None:
    await _log_own_record_write(
        "com.atproto.repo.createRecord",
        {"collection": "app.bsky.feed.post", "repo": "did:plc:abc"},
    )
    redis.set.assert_not_called()

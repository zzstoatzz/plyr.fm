"""Tests for the labeler subscribeLabels consumer.

The consumer exists to close a fail-open window: the label cache is keyed by
subject URI and viewer-independent, so one playback caches "no labels" for
everyone, and an operator-emitted label had no effect on audio authorization
until that entry expired. These tests pin the invalidation behavior, not the
socket plumbing.
"""

from unittest.mock import AsyncMock, patch

from backend._internal.label_stream import LabelStreamConsumer, _ws_url


def _label(uri: str, val: str = "sexual", *, neg: bool = False) -> dict[str, object]:
    return {"uri": uri, "val": val, "neg": neg, "src": "did:plc:labeler"}


async def test_committed_label_invalidates_its_subject() -> None:
    consumer = LabelStreamConsumer()
    uri = "at://did:plc:abc/fm.plyr.track/xyz"

    with patch(
        "backend._internal.label_stream.get_moderation_client"
    ) as mock_get_client:
        client = AsyncMock()
        mock_get_client.return_value = client
        await consumer._process_message({"seq": 7, "labels": [_label(uri)]})

    client.invalidate_cache.assert_awaited_once_with(uri)


async def test_negation_invalidates_too() -> None:
    """A stale cached *presence* keeps a track hidden after a moderator cleared it."""
    consumer = LabelStreamConsumer()
    uri = "at://did:plc:abc/fm.plyr.track/xyz"

    with patch(
        "backend._internal.label_stream.get_moderation_client"
    ) as mock_get_client:
        client = AsyncMock()
        mock_get_client.return_value = client
        await consumer._process_message({"seq": 8, "labels": [_label(uri, neg=True)]})

    client.invalidate_cache.assert_awaited_once_with(uri)


async def test_every_subject_in_a_batched_message_is_invalidated() -> None:
    consumer = LabelStreamConsumer()
    uris = [f"at://did:plc:abc/fm.plyr.track/{n}" for n in range(3)]

    with patch(
        "backend._internal.label_stream.get_moderation_client"
    ) as mock_get_client:
        client = AsyncMock()
        mock_get_client.return_value = client
        await consumer._process_message({"seq": 9, "labels": [_label(u) for u in uris]})

    assert [c.args[0] for c in client.invalidate_cache.await_args_list] == uris


async def test_cursor_advances_to_the_message_sequence() -> None:
    consumer = LabelStreamConsumer()

    with patch(
        "backend._internal.label_stream.get_moderation_client"
    ) as mock_get_client:
        mock_get_client.return_value = AsyncMock()
        await consumer._process_message({"seq": 42, "labels": []})

    assert consumer._cursor == 42


async def test_reconnect_rewinds_one_sequence() -> None:
    """Replaying the last event is free -- invalidation is idempotent."""
    consumer = LabelStreamConsumer()
    consumer._cursor = 42

    assert consumer._build_url().endswith("subscribeLabels?cursor=41")


async def test_first_connect_has_no_cursor() -> None:
    assert LabelStreamConsumer()._build_url().endswith("subscribeLabels")


def test_labeler_origin_maps_to_websocket_scheme() -> None:
    assert _ws_url("https://moderation.plyr.fm") == "wss://moderation.plyr.fm"
    assert _ws_url("http://localhost:8083") == "ws://localhost:8083"

"""the write half of the jetstream echo signal.

every record plyr writes in its own namespace must emit a "pds record write"
log, because the ingest-blackout alert is defined as "writes happened but zero
`jetstream dispatched` logs followed" (#1739). if the write log disappears or
stops matching plyr's namespace, the alert goes permanently silent.
"""

from unittest.mock import patch

from backend._internal.atproto.client import _log_own_record_write
from backend.config import settings


def _own(collection_suffix: str) -> str:
    return f"{settings.atproto.app_namespace}.{collection_suffix}"


def test_own_namespace_create_emits() -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        _log_own_record_write(
            "com.atproto.repo.createRecord",
            {"collection": _own("track"), "repo": "did:plc:abc"},
        )
    info.assert_called_once()
    assert info.call_args.kwargs["collection"] == _own("track")
    assert info.call_args.kwargs["operation"] == "create"


def test_own_namespace_delete_emits() -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        _log_own_record_write(
            "com.atproto.repo.deleteRecord",
            {"collection": _own("like"), "repo": "did:plc:abc"},
        )
    assert info.call_args.kwargs["operation"] == "delete"


def test_foreign_namespace_is_silent() -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        _log_own_record_write(
            "com.atproto.repo.createRecord",
            {"collection": "app.bsky.feed.post", "repo": "did:plc:abc"},
        )
    info.assert_not_called()


def test_non_write_endpoint_is_silent() -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        _log_own_record_write(
            "com.atproto.repo.getRecord",
            {"collection": _own("track")},
        )
    info.assert_not_called()


def test_missing_payload_is_silent() -> None:
    with patch("backend._internal.atproto.client.logfire.info") as info:
        _log_own_record_write("com.atproto.repo.createRecord", None)
    info.assert_not_called()

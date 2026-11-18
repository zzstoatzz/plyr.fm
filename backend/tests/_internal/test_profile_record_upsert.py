"""upsert_profile_record keeps fields other clients wrote."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from backend._internal import Session
from backend._internal.atproto.records.fm_plyr.profile import upsert_profile_record
from backend.config import settings

MODULE = "backend._internal.atproto.records.fm_plyr.profile"


def _session() -> Session:
    session = MagicMock(spec=Session)
    session.did = "did:plc:artist"
    session.oauth_session = {"pds_url": "https://pds.example"}
    return session


async def _upsert(
    existing: dict[str, Any] | None, **kwargs: str | None
) -> dict[str, Any] | None:
    response = MagicMock()
    response.status_code = 200 if existing is not None else 400
    response.json.return_value = {
        "uri": "at://did:plc:artist/x/self",
        "cid": "bafyold",
        "value": existing,
    }
    client = MagicMock()
    client.make_authenticated_request = AsyncMock(return_value=response)
    put = AsyncMock(return_value={"uri": "at://u", "cid": "bafynew"})
    with (
        patch(f"{MODULE}.reconstruct_oauth_session", AsyncMock()),
        patch(f"{MODULE}.get_oauth_client", return_value=client),
        patch(f"{MODULE}.make_pds_request", put),
    ):
        await upsert_profile_record(_session(), **kwargs)
    return put.await_args.args[3] if put.await_args else None


def _profile(**fields: Any) -> dict[str, Any]:
    return {
        "$type": settings.atproto.profile_collection,
        "createdAt": "2026-01-01T00:00:00Z",
        **fields,
    }


async def test_bio_edit_keeps_unknown_fields_and_avatar() -> None:
    existing = _profile(
        bio="old", avatar="https://cdn.example/a.jpg", displayName="nate"
    )
    payload = await _upsert(existing, bio="new")
    assert payload is not None
    record = payload["record"]
    assert record["bio"] == "new"
    assert record["avatar"] == "https://cdn.example/a.jpg"
    assert record["displayName"] == "nate"
    assert record["createdAt"] == "2026-01-01T00:00:00Z"
    assert payload["swapRecord"] == "bafyold"


async def test_uploaded_avatar_wins_over_synced_url() -> None:
    blob = {"$type": "blob", "ref": {"$link": "bafyavatar"}, "mimeType": "image/png"}
    existing = _profile(
        bio="hi", avatar="https://pds.example/getBlob?cid=bafyavatar", avatarBlob=blob
    )
    assert (
        await _upsert(existing, bio="hi", avatar="https://cdn.bsky.app/x.jpg") is None
    )


async def test_unchanged_profile_is_not_rewritten() -> None:
    existing = _profile(bio="hi", avatar="https://cdn.example/a.jpg")
    assert await _upsert(existing, bio="hi", avatar="https://cdn.example/a.jpg") is None


async def test_missing_profile_is_created() -> None:
    payload = await _upsert(None, bio="hi", avatar="https://cdn.example/a.jpg")
    assert payload is not None
    assert payload["record"]["bio"] == "hi"
    assert "swapRecord" not in payload

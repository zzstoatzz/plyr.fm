from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.clients import moderation
from backend._internal.tasks.labels import sync_operator_labels
from backend.models import Artist, Track


@pytest.mark.parametrize(
    ("token", "labels", "overrides", "valid"),
    [
        ("", {"labels": {}}, {"overrides": {}}, False),
        ("token", {}, {"overrides": {}}, False),
        ("token", {"labels": {"at://example": "sexual"}}, {"overrides": {}}, False),
        ("token", {"labels": {}}, {}, False),
        ("token", {"labels": {}}, {"overrides": {"at://example": "unknown"}}, False),
        ("token", {"labels": {}}, {"overrides": {}}, True),
    ],
)
async def test_reconciliation_requires_authoritative_snapshots(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    token: str,
    labels: dict[str, Any],
    overrides: dict[str, Any],
    valid: bool,
) -> None:
    artist = Artist(
        did="did:plc:projection",
        handle="projection.test",
        display_name="Projection",
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="Restricted",
        file_id="projection_integrity",
        file_type="mp3",
        artist_did=artist.did,
        atproto_record_uri="at://did:plc:projection/fm.plyr.track/one",
        operator_labels=["sexual"],
        moderation_override="exclude",
    )
    db_session.add(track)
    await db_session.commit()
    client = moderation.ModerationClient(
        service_url="https://moderation.test",
        labeler_url="https://moderation.test",
        auth_token=token,
        timeout_seconds=5,
        label_cache_prefix="test:projection:",
        label_cache_ttl_seconds=60,
    )
    monkeypatch.setattr(moderation, "_client", client)
    original_client = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/internal/labels-by-value":
            return httpx.Response(200, json=labels)
        assert request.url.path == "/internal/overrides"
        return httpx.Response(200, json=overrides)

    def http_client(**kwargs: Any) -> httpx.AsyncClient:
        return original_client(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", http_client)
    if valid:
        await sync_operator_labels()
    else:
        with pytest.raises(ValueError):
            await sync_operator_labels()

    await db_session.refresh(track)
    assert track.operator_labels == ([] if valid else ["sexual"])
    assert track.moderation_override == (None if valid else "exclude")

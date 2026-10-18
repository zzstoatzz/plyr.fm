import json
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.clients import moderation
from backend._internal.tasks import ingest
from backend.models import Artist, Track

DID = "did:plc:admission"
URI = f"at://{DID}/fm.plyr.track/one"


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    artist = Artist(
        did=DID,
        handle="admission.test",
        display_name="Admission",
        pds_url="https://pds.example.com",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


def record() -> dict[str, Any]:
    return {
        "title": "Replacement",
        "artist": "Admission",
        "fileId": "admission_new",
        "fileType": "mp3",
        "audioBlob": {"ref": {"$link": "bafynewblob"}, "mimeType": "audio/mpeg"},
        "createdAt": datetime.now(UTC).isoformat(),
    }


def configure_authority(
    monkeypatch: pytest.MonkeyPatch, mode: str
) -> list[httpx.Request]:
    client = moderation.ModerationClient(
        service_url="https://moderation.test",
        labeler_url="https://moderation.test",
        auth_token="" if mode == "missing_token" else "token",
        timeout_seconds=5,
        label_cache_prefix="test:admission:",
        label_cache_ttl_seconds=60,
    )
    monkeypatch.setattr(moderation, "_client", client)
    requests: list[httpx.Request] = []
    original_client = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path == "/internal/indexing-decisions"
        assert json.loads(request.content) == {"uris": [URI]}
        assert request.headers["X-Moderation-Key"] == "token"
        if mode == "timeout":
            raise httpx.ReadTimeout("authority timed out", request=request)
        if mode == "unavailable":
            return httpx.Response(503)
        payload: dict[str, Any] = {
            "decisions": {
                URI: None
                if mode == "unset"
                else {"event_id": 7, "excluded": mode == "excluded"}
            }
        }
        if mode == "missing_subject":
            payload = {"decisions": {}}
        elif mode == "missing_snapshot":
            payload = {}
        elif mode == "malformed":
            payload = {"decisions": {URI: {"event_id": 7, "excluded": "false"}}}
        elif mode == "wrong_subject":
            payload = {"decisions": {URI + "other": None}}
        return httpx.Response(200, json=payload)

    def http_client(**kwargs: Any) -> httpx.AsyncClient:
        return original_client(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", http_client)
    return requests


@pytest.mark.parametrize("operation", ["create", "pending", "update"])
@pytest.mark.parametrize(
    "mode",
    [
        "excluded",
        "missing_token",
        "missing_subject",
        "missing_snapshot",
        "malformed",
        "wrong_subject",
        "unavailable",
        "timeout",
        "unset",
        "cleared",
    ],
)
async def test_admission_precedes_mutations_and_effects(
    db_session: AsyncSession,
    artist: Artist,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    mode: str,
) -> None:
    requests = configure_authority(monkeypatch, mode)
    hooks = AsyncMock()
    mirror = AsyncMock()
    monkeypatch.setattr(ingest, "run_post_track_create_hooks", hooks)
    monkeypatch.setattr(ingest, "schedule_pds_blob_mirror", mirror)
    original: Track | None = None
    if operation != "create":
        original = Track(
            title="Original",
            artist_did=artist.did,
            file_id="admission_original",
            file_type="mp3",
            atproto_record_uri=URI,
            atproto_record_cid="bafyold",
            pds_blob_cid="bafyoldblob",
            publish_state="pending" if operation == "pending" else "published",
        )
        db_session.add(original)
        await db_session.commit()
    call = (
        ingest.ingest_track_update
        if operation == "update"
        else ingest.ingest_track_create
    )
    if mode in {"excluded", "unset", "cleared"}:
        await call(did=artist.did, rkey="one", record=record(), uri=URI, cid="bafynew")
    else:
        with pytest.raises((ValueError, httpx.HTTPError)):
            await call(
                did=artist.did, rkey="one", record=record(), uri=URI, cid="bafynew"
            )
    allowed = mode in {"unset", "cleared"}
    if original is not None:
        await db_session.refresh(original)
        assert original.atproto_record_cid == ("bafynew" if allowed else "bafyold")
        if operation == "pending":
            assert original.publish_state == ("published" if allowed else "pending")
        else:
            assert original.title == ("Replacement" if allowed else "Original")
            assert original.pds_blob_cid == (
                "bafynewblob" if allowed else "bafyoldblob"
            )
    else:
        created = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == URI)
        )
        assert (created is not None) == allowed
    if not allowed:
        hooks.assert_not_awaited()
        mirror.assert_not_awaited()
    elif operation == "update":
        mirror.assert_awaited_once()
    else:
        hooks.assert_awaited_once()
    assert len(requests) == (0 if mode == "missing_token" else 1)


async def test_unknown_artist_and_deletes_do_not_depend_on_authority(
    db_session: AsyncSession, artist: Artist, monkeypatch: pytest.MonkeyPatch
) -> None:
    requests = configure_authority(monkeypatch, "unavailable")
    await ingest.ingest_track_create(
        did="did:plc:unknown", rkey="one", record=record(), uri=URI, cid="bafynew"
    )
    track = Track(
        title="Delete me",
        artist_did=artist.did,
        file_id="delete_admission",
        file_type="mp3",
        atproto_record_uri=URI,
    )
    db_session.add(track)
    await db_session.commit()
    await ingest.ingest_track_delete(did=artist.did, rkey="one", uri=URI)
    assert (
        await db_session.scalar(select(Track).where(Track.atproto_record_uri == URI))
        is None
    )
    assert requests == []

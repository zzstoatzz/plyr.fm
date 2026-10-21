"""Real HTTP and Redis queue paths deliver pause alerts through the operator bot."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
import pytest
from docket import Docket, Worker
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import (
    Session,
    background,
    require_artist_profile,
    require_auth,
    upload_policy,
)
from backend._internal.clients import moderation
from backend._internal.notifications import (
    DmMessage,
    NotificationResult,
    notification_service,
)
from backend._internal.tasks import _build_background_tasks
from backend._internal.tasks.ingest import ingest_track_create, ingest_track_update
from backend._internal.upload_notifications import deliver_upload_feedback_notification
from backend.config import settings
from backend.models import Artist, Track, UploadFeedback

DID = "did:plc:so3ysj7gypel6w7mixdfjhkh"


@pytest.fixture
async def docket(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Docket]:
    async with Docket(name=f"pause-dms-{uuid4()}", url=settings.docket.url) as queue:
        for task in _build_background_tasks():
            queue.register(task)
        monkeypatch.setattr(background, "_docket", queue)
        yield queue


@pytest.fixture
async def client(
    fastapi_app: FastAPI, db_session: AsyncSession
) -> AsyncIterator[httpx.AsyncClient]:
    async def authenticated() -> Session:
        return Session(
            session_id="pause-dm", did=DID, handle="renamed.test", oauth_session={}
        )

    fastapi_app.dependency_overrides[require_auth] = authenticated
    fastapi_app.dependency_overrides[require_artist_profile] = authenticated
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fastapi_app),
            base_url="http://test",
            headers={"fly-client-ip": uuid4().hex},
        ) as api:
            yield api
    finally:
        fastapi_app.dependency_overrides.clear()


@pytest.fixture
def messages(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    sent: list[str] = []

    async def ready() -> str:
        return "did:plc:operator"

    async def send(recipient_did: str, message: DmMessage) -> NotificationResult:
        assert recipient_did == "did:plc:operator"
        assert isinstance(message, str)
        assert len(message) <= 1000
        assert len(message.encode()) <= 10000
        sent.append(message)
        return NotificationResult(success=True, recipient_did=recipient_did)

    monkeypatch.setattr(notification_service, "ensure_ready", ready)
    monkeypatch.setattr(notification_service, "_send_dm_to_did", send)
    return sent


async def drain(docket: Docket) -> None:
    async with Worker(docket, schedule_automatic_tasks=False) as worker:
        await worker.run_until_finished()


async def test_every_upload_entrypoint_delivers_but_stays_blocked(
    client: httpx.AsyncClient, docket: Docket, messages: list[str]
) -> None:
    responses = [
        await client.post(
            "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
        ),
        await client.post(
            "/tracks/", data={"title": "mix"}, files={"file": ("mix.wav", b"test")}
        ),
        await client.put("/tracks/123/audio", files={"file": ("mix.wav", b"test")}),
        await client.put("/tracks/uploads/old/parts/1", content=b"test"),
        await client.post("/tracks/uploads/old/finish", data={"title": "mix"}),
    ]
    assert all(response.status_code == 403 for response in responses)
    assert messages == []
    assert (await client.get("/tracks/me/upload-summary")).status_code == 200
    await drain(docket)
    assert len(messages) == 6
    assert all(DID in message and "renamed.test" in message for message in messages)
    for event in [
        "blocked upload\n",
        "blocked resumable upload",
        "blocked audio replacement",
        "blocked upload part",
        "blocked upload finish",
        "viewed upload pause notice",
    ]:
        assert any(event in message for message in messages)


async def test_other_accounts_stay_quiet_and_list_extensions_notify(
    client: httpx.AsyncClient,
    docket: Docket,
    messages: list[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(upload_policy, "PAUSED_UPLOAD_DIDS", frozenset())
    assert (await client.get("/tracks/me/upload-summary")).status_code == 200
    response = await client.post(
        "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
    )
    assert response.status_code == 200, response.text
    await drain(docket)
    assert messages == []
    monkeypatch.setattr(upload_policy, "PAUSED_UPLOAD_DIDS", frozenset({DID}))
    assert (await client.get("/tracks/me/upload-summary")).status_code == 200
    await drain(docket)
    assert len(messages) == 1


async def test_full_submitted_feedback_is_saved_then_delivered(
    client: httpx.AsyncClient,
    docket: Docket,
    messages: list[str],
    db_session: AsyncSession,
) -> None:
    feedback = "🎶é" * 999 + "終!"
    response = await client.post(
        "/tracks/me/upload-feedback", json={"message": feedback}
    )
    assert response.status_code == 201, response.text
    saved = await db_session.get(UploadFeedback, response.json()["id"])
    assert saved is not None and saved.message == feedback
    assert messages == []
    await drain(docket)
    assert len(messages) == 3
    reconstructed = "".join(part.split(") ", 1)[1] for part in messages)
    assert reconstructed.endswith(feedback)
    assert DID in reconstructed and "renamed.test" in reconstructed


async def test_queue_outage_falls_back_without_allowing_uploads(
    client: httpx.AsyncClient, messages: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(background, "_docket", None)
    response = await client.post(
        "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
    )
    assert response.status_code == 403
    assert len(messages) == 1
    assert "blocked resumable upload" in messages[0]


async def test_delivery_failure_is_retryable_and_preserves_feedback(
    db_session: AsyncSession, messages: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    feedback = UploadFeedback(
        did=DID, handle="renamed.test", message="please contact me"
    )
    db_session.add(feedback)
    await db_session.commit()

    async def failed(recipient_did: str, message: DmMessage) -> NotificationResult:
        return NotificationResult(
            success=False, recipient_did=recipient_did, error="offline"
        )

    with monkeypatch.context() as failed_transport:
        failed_transport.setattr(notification_service, "_send_dm_to_did", failed)
        with pytest.raises(RuntimeError, match="delivery failed"):
            await deliver_upload_feedback_notification(feedback.id)
    await db_session.refresh(feedback)
    assert feedback.message == "please contact me"
    await deliver_upload_feedback_notification(feedback.id)
    assert "please contact me" in messages[0]


async def test_external_publication_and_audio_change_notify_but_metadata_does_not(
    docket: Docket,
    messages: list[str],
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uri = f"at://{DID}/fm.plyr.track/existing"
    db_session.add(Artist(did=DID, handle="external.test", display_name="artist"))
    await db_session.flush()
    track = Track(
        title="old",
        artist_did=DID,
        file_id="old",
        file_type="mp3",
        pds_blob_cid="bafyold",
        audio_storage="pds",
        atproto_record_uri=uri,
    )
    db_session.add(track)
    await db_session.commit()
    original_client = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/indexing-decisions"
        return httpx.Response(200, json={"decisions": {uri: None}})

    def remote_client(**kwargs: Any) -> httpx.AsyncClient:
        return original_client(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", remote_client)
    monkeypatch.setattr(
        moderation,
        "_client",
        moderation.ModerationClient(
            service_url="https://moderation.test",
            labeler_url="https://moderation.test",
            auth_token="test",
            timeout_seconds=5,
            label_cache_prefix="pause-dm:",
            label_cache_ttl_seconds=60,
        ),
    )
    record: dict[str, Any] = {
        "title": "new",
        "artist": "artist",
        "fileType": "mp3",
        "audioBlob": {"ref": {"$link": "bafyold"}, "mimeType": "audio/mpeg"},
        "createdAt": datetime.now(UTC).isoformat(),
    }
    await ingest_track_update(DID, "existing", record, uri, "cid1")
    await drain(docket)
    assert messages == []
    await db_session.refresh(track)
    assert track.title == "new"
    record["audioBlob"]["ref"]["$link"] = "bafynew"
    await ingest_track_update(DID, "existing", record, uri, "cid2")
    await ingest_track_create(DID, "another", record, uri + "another", "cid3")
    await drain(docket)
    assert len(messages) == 2
    assert all("external.test" in message for message in messages)
    assert any(
        "audio change observed while uploads paused" in message for message in messages
    )
    assert any("blocked external track publication" in message for message in messages)
    await db_session.refresh(track)
    assert track.pds_blob_cid == "bafyold"
    track.audio_storage = "r2_private"
    await db_session.commit()
    record["audioUrl"] = "https://api.plyr.fm/audio/old"
    record["audioBlob"]["ref"]["$link"] = "bafyold"
    await ingest_track_update(DID, "existing", record, uri, "cid4")
    await drain(docket)
    assert len(messages) == 2


async def test_queue_and_dm_outage_still_blocks_uploads_and_saves_feedback(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def unavailable() -> None:
        return None

    monkeypatch.setattr(background, "_docket", None)
    monkeypatch.setattr(notification_service, "ensure_ready", unavailable)
    response = await client.post(
        "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
    )
    assert response.status_code == 403
    response = await client.post(
        "/tracks/me/upload-feedback", json={"message": "saved despite outage"}
    )
    assert response.status_code == 201
    saved = await db_session.get(UploadFeedback, response.json()["id"])
    assert saved is not None and saved.message == "saved despite outage"


async def test_feedback_text_is_not_truncated(messages: list[str]) -> None:
    message = "a" * 1999 + "!"
    result = await notification_service.send_upload_feedback_notification(
        123, "test.account", message
    )
    assert result is not None and result.success
    assert len(messages) == 3
    assert "".join(part.split(") ", 1)[1] for part in messages).endswith(message)

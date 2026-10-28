"""Verify protected-source mirroring before exposing a URL to processors."""

import asyncio
import hashlib
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from typing import BinaryIO

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import get_optional_session
from backend._internal.atproto.spaces import protected_audio as protected
from backend._internal.tasks import hooks
from backend._internal.tasks.pds_mirror import cid_for_blob
from backend.api import audio as audio_api
from backend.config import settings
from backend.models import Artist, Track


@dataclass
class SourceServer:
    body: bytes = b"the artist's protected source audio"
    status: int = 200
    content_type: str = "audio/mpeg"
    requests: int = 0
    url: str = ""


@dataclass
class PrivateStorage:
    objects: dict[tuple[str, str], bytes] = field(default_factory=dict)
    writes: list[tuple[str, str]] = field(default_factory=list)
    signed: list[tuple[str, str]] = field(default_factory=list)
    after_save: Callable[[], Awaitable[None]] | None = None
    wrong_save_id: bool = False

    async def save(self, source: BinaryIO, filename: str) -> str:
        body = source.read()
        file_id = hashlib.sha256(body).hexdigest()[:16]
        extension = filename.rsplit(".", 1)[1]
        key = (file_id, extension)
        self.objects[key] = body
        self.writes.append(key)
        if self.after_save is not None:
            await self.after_save()
        return "wrong-content-hash" if self.wrong_save_id else file_id

    async def head(
        self, file_id: str, file_type: str, *, private: bool = False
    ) -> int | None:
        assert private, "protected mirrors must use private storage"
        body = self.objects.get((file_id, file_type))
        return len(body) if body is not None else None

    async def sign(self, *, file_id: str, extension: str) -> str:
        key = (file_id, extension)
        assert key in self.objects
        self.signed.append(key)
        return f"https://private.example/{file_id}.{extension}"


@pytest.fixture
async def source_server(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[SourceServer]:
    source = SourceServer()

    async def respond(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            await reader.readuntil(b"\r\n\r\n")
            source.requests += 1
            writer.write(
                f"HTTP/1.1 {source.status} Result\r\n"
                f"Content-Length: {len(source.body)}\r\n"
                f"Content-Type: {source.content_type}\r\nConnection: close\r\n\r\n".encode()
            )
            writer.write(source.body[:8])
            await writer.drain()
            await asyncio.sleep(0)
            writer.write(source.body[8:])
            await writer.drain()
        finally:
            writer.close()
            with suppress(ConnectionError):
                await writer.wait_closed()

    @asynccontextmanager
    async def open_source(
        audio: dict, *, original: bool = False, range_header: str | None = None
    ) -> AsyncIterator[httpx.Response]:
        assert not original
        assert range_header is None
        async with (
            httpx.AsyncClient(timeout=2) as client,
            client.stream("GET", source.url) as response,
        ):
            yield response

    async with await asyncio.start_server(respond, "127.0.0.1", 0) as server:
        source.url = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}/source"
        monkeypatch.setattr(protected, "open_protected_blob", open_source)
        yield source


@pytest.fixture
def private_storage(monkeypatch: pytest.MonkeyPatch) -> PrivateStorage:
    storage = PrivateStorage()
    monkeypatch.setattr(protected.storage, "save_gated", storage.save)
    monkeypatch.setattr(protected.storage, "head_file", storage.head)
    monkeypatch.setattr(hooks.storage, "generate_presigned_url", storage.sign)
    return storage


@pytest.fixture(autouse=True)
def approved_app_credentials(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    checked: list[str] = []

    async def approve(session: object, space: str) -> None:
        assert session is None
        checked.append(space)

    monkeypatch.setattr(protected, "get_space_credential", approve)
    return checked


@pytest.fixture(autouse=True)
def mirror_retries(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    queued: list[int] = []

    async def schedule(track_id: int) -> None:
        queued.append(track_id)

    monkeypatch.setattr(
        hooks, "schedule_protected_audio_mirror", schedule, raising=False
    )
    return queued


async def create_track(db: AsyncSession, body: bytes) -> Track:
    owner = Artist(
        did="did:plc:protectedmirror", handle="mirror.test", display_name="Mirror"
    )
    db.add(owner)
    await db.flush()
    file_id = hashlib.sha256(body).hexdigest()[:16]
    record_uri = (
        f"at://{owner.did}/space/{settings.atproto.private_media_space_type}"
        f"/playback/{owner.did}/{settings.atproto.track_collection}/source"
    )
    track = Track(
        artist_did=owner.did,
        title="protected source",
        file_id=file_id,
        file_type="mp3",
        audio_storage="r2_private",
        visibility="public",
        download_policy="off",
        notification_sent=True,
        protected_audio={
            "record_uri": record_uri,
            "record_cid": "source-record-cid",
            "audio_blob": {
                "$type": "blob",
                "ref": {"$link": cid_for_blob(body)},
                "mimeType": "audio/mpeg",
                "size": len(body),
            },
            "mirror_verified": False,
        },
    )
    db.add(track)
    await db.commit()
    return track


async def test_verified_source_is_mirrored_before_hook_url_is_signed(
    db_session: AsyncSession,
    source_server: SourceServer,
    private_storage: PrivateStorage,
) -> None:
    track = await create_track(db_session, source_server.body)
    url = await hooks.resolve_audio_url(track.id)
    await db_session.refresh(track)
    assert url == f"https://private.example/{track.file_id}.mp3"
    assert private_storage.objects[(track.file_id, "mp3")] == source_server.body
    assert track.protected_audio is not None
    assert track.protected_audio["mirror_verified"] is True
    assert private_storage.signed == [(track.file_id, "mp3")]
    assert source_server.requests == 1
    assert await hooks.resolve_audio_url(track.id) == url
    assert source_server.requests == 1


@pytest.mark.parametrize(
    "mismatch", ["cid", "size", "content_hash", "saved_hash", "http"]
)
async def test_invalid_source_never_produces_a_processor_url(
    db_session: AsyncSession,
    source_server: SourceServer,
    private_storage: PrivateStorage,
    mismatch: str,
    mirror_retries: list[int],
) -> None:
    track = await create_track(db_session, source_server.body)
    assert track.protected_audio is not None
    audio = dict(track.protected_audio)
    blob = dict(audio["audio_blob"])
    if mismatch == "cid":
        blob["ref"] = {"$link": cid_for_blob(b"another source")}
    elif mismatch == "size":
        blob["size"] += 1
    elif mismatch == "content_hash":
        victim = b"another artist's private audio"
        track.file_id = hashlib.sha256(victim).hexdigest()[:16]
        private_storage.objects[(track.file_id, "mp3")] = victim
    elif mismatch == "saved_hash":
        private_storage.wrong_save_id = True
    else:
        source_server.status = 503
    audio["audio_blob"] = blob
    track.protected_audio = audio
    await db_session.commit()
    before = dict(private_storage.objects)
    assert await hooks.resolve_audio_url(track.id) is None
    await db_session.refresh(track)
    assert track.protected_audio is not None
    assert track.protected_audio["mirror_verified"] is False
    assert private_storage.signed == []
    assert source_server.requests == 1
    assert mirror_retries == ([track.id] if mismatch == "http" else [])
    if mismatch == "saved_hash":
        assert len(private_storage.writes) == 1
    else:
        assert private_storage.writes == []
        assert private_storage.objects == before


async def test_source_change_during_mirroring_does_not_verify_the_new_source(
    db_session: AsyncSession,
    source_server: SourceServer,
    private_storage: PrivateStorage,
) -> None:
    track = await create_track(db_session, source_server.body)
    assert track.protected_audio is not None
    changed = {**track.protected_audio, "record_cid": "new-source-record"}

    async def replace_source() -> None:
        await db_session.execute(
            update(Track).where(Track.id == track.id).values(protected_audio=changed)
        )
        await db_session.commit()

    private_storage.after_save = replace_source
    assert await hooks.resolve_audio_url(track.id) is None
    await db_session.refresh(track)
    assert track.protected_audio == changed
    assert track.protected_audio["mirror_verified"] is False
    assert private_storage.signed == []
    assert source_server.requests == 1


async def test_unverified_import_cannot_scan_another_artists_private_mirror(
    db_session: AsyncSession,
    source_server: SourceServer,
    private_storage: PrivateStorage,
    monkeypatch: pytest.MonkeyPatch,
    mirror_retries: list[int],
) -> None:
    track = await create_track(db_session, source_server.body)
    victim = b"other artist's audio"
    victim_id = hashlib.sha256(victim).hexdigest()[:16]
    private_storage.objects[(victim_id, "mp3")] = victim
    track.file_id = victim_id
    await db_session.commit()
    scheduled: list[tuple[int, str]] = []

    async def schedule(track_id: int, audio_url: str) -> None:
        scheduled.append((track_id, audio_url))

    monkeypatch.setattr(hooks, "schedule_copyright_scan", schedule)
    monkeypatch.setattr(hooks, "schedule_embedding_generation", schedule)
    monkeypatch.setattr(hooks, "schedule_genre_classification", schedule)
    await hooks.run_post_track_create_hooks(track.id, skip_notification=True)
    assert scheduled == []
    assert mirror_retries == []
    assert private_storage.signed == []
    assert private_storage.writes == []
    assert private_storage.objects[(victim_id, "mp3")] == victim
    await db_session.refresh(track)
    assert track.protected_audio is not None
    assert track.protected_audio["mirror_verified"] is False


async def test_transient_source_failure_queues_retry_without_scanning(
    db_session: AsyncSession,
    source_server: SourceServer,
    private_storage: PrivateStorage,
    mirror_retries: list[int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    track = await create_track(db_session, source_server.body)
    source_server.status = 503
    scheduled: list[tuple[int, str]] = []

    async def schedule(track_id: int, audio_url: str) -> None:
        scheduled.append((track_id, audio_url))

    monkeypatch.setattr(hooks, "schedule_copyright_scan", schedule)
    monkeypatch.setattr(hooks, "schedule_embedding_generation", schedule)
    monkeypatch.setattr(hooks, "schedule_genre_classification", schedule)
    await hooks.run_post_track_create_hooks(track.id, skip_notification=True)
    assert mirror_retries == [track.id]
    assert source_server.requests == 1
    assert scheduled == []
    assert private_storage.signed == []
    assert private_storage.writes == []
    await db_session.refresh(track)
    assert track.protected_audio is not None
    assert track.protected_audio["mirror_verified"] is False


async def test_pds_playback_proxy_keeps_audio_type_and_closes_stream(
    db_session: AsyncSession,
    source_server: SourceServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_server.content_type = "text/html"
    track = await create_track(db_session, source_server.body)
    assert track.protected_audio is not None

    async def approved(_session: object, _space: str) -> None:
        return None

    monkeypatch.setattr(audio_api, "get_space_credential", approved)
    monkeypatch.setattr(audio_api, "open_protected_blob", protected.open_protected_blob)
    response = await audio_api._serve_protected_audio(track.protected_audio)
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert isinstance(response, StreamingResponse)
    output = bytearray()
    async for chunk in response.body_iterator:
        assert isinstance(chunk, bytes)
        output.extend(chunk)
    assert bytes(output) == source_server.body
    assert source_server.requests == 1


@pytest.mark.parametrize("verified", [False, True])
async def test_revoked_app_access_never_signs_even_an_existing_mirror(
    db_session: AsyncSession,
    source_server: SourceServer,
    private_storage: PrivateStorage,
    monkeypatch: pytest.MonkeyPatch,
    mirror_retries: list[int],
    verified: bool,
) -> None:
    track = await create_track(db_session, source_server.body)
    assert track.protected_audio is not None
    track.protected_audio = {**track.protected_audio, "mirror_verified": verified}
    await db_session.commit()
    private_storage.objects[(track.file_id, "mp3")] = source_server.body

    async def deny(session: object, space: str) -> None:
        assert session is None
        assert space.endswith("/playback")
        raise protected.SpaceAccessError("app removed from allowlist")

    monkeypatch.setattr(protected, "get_space_credential", deny)
    assert await hooks.resolve_audio_url(track.id) is None
    assert private_storage.signed == []
    assert private_storage.writes == []
    assert source_server.requests == 0
    assert mirror_retries == []


@pytest.mark.parametrize("endpoint", ["", "/url"])
@pytest.mark.parametrize("policy,expected_status", [("off", 403), ("supporters", 401)])
async def test_shared_playback_hash_cannot_authorize_another_tracks_original(
    db_session: AsyncSession, endpoint: str, policy: str, expected_status: int
) -> None:
    protected_track = await create_track(db_session, b"shared playback")
    protected_track.original_file_id = "protected-original"
    protected_track.original_file_type = "aiff"
    protected_track.download_policy = policy
    public_track = Track(
        artist_did=protected_track.artist_did,
        title="open sibling",
        file_id=protected_track.file_id,
        file_type="mp3",
        original_file_id="public-original",
        original_file_type="wav",
        download_policy="open",
        r2_url="https://public.example/playback.mp3",
    )
    db_session.add(public_track)
    await db_session.commit()
    application = FastAPI()
    application.include_router(audio_api.router)
    application.dependency_overrides[get_optional_session] = lambda: None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test"
    ) as client:
        response = await client.get(f"/audio/protected-original{endpoint}")
    assert response.status_code == expected_status
    assert "location" not in response.headers

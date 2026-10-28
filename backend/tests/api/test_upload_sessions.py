"""resumable upload sessions: start → parts → finish.

drives the real endpoints against the in-memory multipart store in
`MockStorage`; only the docket enqueue is mocked.
"""

import hashlib
import json
from collections.abc import AsyncIterable, Awaitable, Callable, Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from cachetools import TTLCache
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

import backend.storage
from backend._internal import Session, require_artist_profile
from backend._internal.atproto.spaces import capability
from backend._internal.jobs import job_service
from backend.api.tracks.uploads import (
    UploadContext,
    _settle_staged_audio,
    parse_upload_metadata,
)
from backend.models import Album, Artist, UserPreferences
from backend.models.job import Job, JobStatus, JobType
from backend.storage.keys import StagedUploadKey
from backend.upload_limits import MAX_FILE_BYTES
from backend.utilities.database import db_session as database_session

PART = 8
_AUDIO = bytes(range(20))  # 3 parts of 8, last is 4


class _ArtistSession(Session):
    def __init__(self, did: str = "did:test:artist") -> None:
        self.did = did
        self.handle = "artist.test"
        self.session_id = f"session-{did}"
        self.oauth_session = {
            "did": did,
            "handle": self.handle,
            "pds_url": "https://test.pds",
            "scope": "atproto transition:generic",
            "access_token": "t",
            "refresh_token": "r",
            "dpop_private_key_pem": "fake",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture(autouse=True)
def unsupported_fixture_pds(monkeypatch: pytest.MonkeyPatch) -> None:
    cache: TTLCache[str, bool] = TTLCache(maxsize=10, ttl=300)
    cache["https://test.pds"] = False
    monkeypatch.setattr(capability, "_capabilities", cache)


@pytest.fixture
def artist_app(
    fastapi_app: FastAPI, db_session: AsyncSession
) -> Generator[FastAPI, None, None]:
    async def _profile() -> Session:
        return _ArtistSession()

    fastapi_app.dependency_overrides[require_artist_profile] = _profile
    with patch("backend.api.tracks.upload_sessions.PART_SIZE_BYTES", PART):
        yield fastapi_app
    fastapi_app.dependency_overrides.clear()


def _mock_storage():
    return backend.storage._storage


def _start(client: TestClient, size: int = len(_AUDIO)) -> dict:
    resp = client.post(
        "/tracks/uploads", json={"filename": "song.wav", "size_bytes": size}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _send_parts(
    client: TestClient, upload_id: str, skip: set[int] | None = None
) -> None:
    skip = skip or set()
    for n, start in enumerate(range(0, len(_AUDIO), PART), start=1):
        if n in skip:
            continue
        resp = client.put(
            f"/tracks/uploads/{upload_id}/parts/{n}",
            content=_AUDIO[start : start + PART],
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["part_number"] == n


@pytest.mark.parametrize("visibility", ["public", "unlisted"])
@pytest.mark.parametrize("download_policy", ["open", "off", "supporters"])
def test_session_round_trip_enqueues_a_staged_upload(
    artist_app: FastAPI, visibility: str, download_policy: str
) -> None:
    with (
        TestClient(artist_app) as client,
        patch(
            "backend.api.tracks.upload_sessions.schedule_track_upload",
            new=AsyncMock(),
        ) as schedule,
    ):
        session = _start(client)
        assert session["part_size_bytes"] == PART
        assert session["part_count"] == 3
        upload_id = session["upload_id"]

        _send_parts(client, upload_id, skip={2})
        state = client.get(f"/tracks/uploads/{upload_id}").json()
        assert state["received_parts"] == [1, 3]

        _send_parts(client, upload_id)
        resp = client.post(
            f"/tracks/uploads/{upload_id}/finish",
            data={
                "title": "song",
                "publishing": json.dumps(
                    {"access": {"visibility": visibility, "downloads": download_policy}}
                ),
                "tags": '["a"]',
                "accept_plyr_storage": "true",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["upload_id"] == upload_id

    schedule.assert_awaited_once()
    assert schedule.await_args is not None
    ctx: UploadContext = schedule.await_args.args[0]
    assert ctx.visibility == visibility
    assert ctx.support_gate is None
    assert ctx.private_audio is (download_policy in ("off", "supporters"))
    assert ctx.download_policy == download_policy
    assert ctx.copyright_rights is None
    assert ctx.staged is True
    assert ctx.audio_file_id == ""
    assert ctx.filename == "song.wav"
    assert ctx.tags == ["a"]
    assert ctx.upload_id == upload_id
    assert _mock_storage().staged_objects[ctx.staged_key.key] == _AUDIO


async def test_finish_with_a_missing_part_keeps_the_session_open(
    artist_app: FastAPI,
) -> None:
    with (
        TestClient(artist_app) as client,
        patch(
            "backend.api.tracks.upload_sessions.schedule_track_upload",
            new=AsyncMock(),
        ) as schedule,
    ):
        upload_id = _start(client)["upload_id"]
        _send_parts(client, upload_id, skip={3})
        resp = client.post(
            f"/tracks/uploads/{upload_id}/finish", data={"title": "song"}
        )
        assert resp.status_code == 409
        assert client.get(f"/tracks/uploads/{upload_id}").status_code == 200

    schedule.assert_not_awaited()
    job = await job_service.get_job(upload_id)
    assert job is not None
    assert job.status == JobStatus.PENDING.value
    assert job.phase == "transfer"


def test_part_of_the_wrong_size_is_rejected(artist_app: FastAPI) -> None:
    with TestClient(artist_app) as client:
        upload_id = _start(client)["upload_id"]
        resp = client.put(f"/tracks/uploads/{upload_id}/parts/1", content=b"short")
        assert resp.status_code == 400
        assert "must be 8 bytes" in resp.json()["detail"]
        resp = client.put(f"/tracks/uploads/{upload_id}/parts/4", content=b"x" * 8)
        assert resp.status_code == 400


def test_metadata_is_validated_before_the_parts_are_assembled(
    artist_app: FastAPI,
) -> None:
    with TestClient(artist_app) as client:
        upload_id = _start(client)["upload_id"]
        _send_parts(client, upload_id)
        resp = client.post(
            f"/tracks/uploads/{upload_id}/finish",
            data={"title": "song", "visibility": "private"},
        )
        assert resp.status_code == 400
        assert "unknown upload fields" in resp.json()["detail"]
        assert client.get(f"/tracks/uploads/{upload_id}").json()["received_parts"] == [
            1,
            2,
            3,
        ]


def test_rejected_cover_image_keeps_the_session_open(artist_app: FastAPI) -> None:
    with TestClient(artist_app) as client:
        upload_id = _start(client)["upload_id"]
        _send_parts(client, upload_id)
        resp = client.post(
            f"/tracks/uploads/{upload_id}/finish",
            data={"title": "song"},
            files={
                "image": (
                    "cover.png",
                    b"\x89PNG" + b"0" * (20 * 1024 * 1024),
                    "image/png",
                )
            },
        )
        assert resp.status_code == 413
        state = client.get(f"/tracks/uploads/{upload_id}").json()
        assert state["received_parts"] == [1, 2, 3]


def test_start_rejects_unsupported_and_oversized_files(artist_app: FastAPI) -> None:
    with TestClient(artist_app) as client:
        resp = client.post(
            "/tracks/uploads", json={"filename": "notes.txt", "size_bytes": 10}
        )
        assert resp.status_code == 400
        resp = client.post(
            "/tracks/uploads",
            json={"filename": "song.wav", "size_bytes": 2 * 1024**3},
        )
        assert resp.status_code == 413


@pytest.mark.parametrize("extra,status", [(0, 200), (1, 413)])
def test_admission_matches_transcoder_file_boundary(
    artist_app: FastAPI, extra: int, status: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "backend.api.tracks.upload_sessions.PART_SIZE_BYTES", 10 * 1024 * 1024
    )
    with TestClient(artist_app) as client:
        response = client.post(
            "/tracks/uploads",
            json={"filename": "boundary.flac", "size_bytes": MAX_FILE_BYTES + extra},
        )
    assert response.status_code == status


async def test_another_artist_cannot_touch_the_session(artist_app: FastAPI) -> None:
    foreign_id = await job_service.create_job(
        JobType.UPLOAD, "did:test:someone-else", "uploading your file..."
    )
    await job_service.update_progress(
        foreign_id,
        JobStatus.PENDING,
        "uploading your file...",
        phase="transfer",
        result={
            "transfer": {
                "multipart_id": "mp",
                "filename": "x.wav",
                "extension": "wav",
                "size_bytes": 8,
                "part_size_bytes": 8,
                "part_count": 1,
            }
        },
    )
    with TestClient(artist_app) as client:
        assert client.get(f"/tracks/uploads/{foreign_id}").status_code == 404
        resp = client.put(f"/tracks/uploads/{foreign_id}/parts/1", content=b"x" * 8)
        assert resp.status_code == 404


async def test_settle_promotes_staged_bytes_to_their_content_hash(
    db_session: AsyncSession,
) -> None:
    storage = _mock_storage()
    staged = StagedUploadKey(upload_id="u-settle", extension="wav")
    storage.staged_objects[staged.key] = _AUDIO
    ctx = _staged_ctx("u-settle")

    await _settle_staged_audio(ctx)

    expected = hashlib.sha256(_AUDIO).hexdigest()[:16]
    assert ctx.audio_file_id == expected
    assert storage.promoted[f"audio/{expected}.wav"] == (staged.key, False)
    assert staged.key not in storage.staged_objects


@pytest.mark.parametrize("gate_type", ["any", "copyright", None])
async def test_settle_gated_upload_lands_in_the_private_bucket(
    db_session: AsyncSession,
    gate_type: str | None,
) -> None:
    storage = _mock_storage()
    staged = StagedUploadKey(upload_id="u-gated", extension="wav")
    storage.staged_objects[staged.key] = _AUDIO
    ctx = _staged_ctx(
        "u-gated", support_gate={"type": gate_type} if gate_type else None
    )
    ctx.private_audio = gate_type is None

    await _settle_staged_audio(ctx)

    assert storage.promoted[f"audio/{ctx.audio_file_id}.wav"][1] is True


async def test_settle_private_upload_writes_the_pds_blob_and_no_r2_object(
    db_session: AsyncSession,
) -> None:
    storage = _mock_storage()
    staged = StagedUploadKey(upload_id="u-private", extension="wav")
    storage.staged_objects[staged.key] = _AUDIO
    ctx = _staged_ctx("u-private", visibility="private")
    blob = {
        "$type": "blob",
        "ref": {"$link": "bafk"},
        "mimeType": "audio/wav",
        "size": 1,
    }

    with patch(
        "backend.api.tracks.uploads.upload_blob", new=AsyncMock(return_value=blob)
    ) as upload_blob:
        await _settle_staged_audio(ctx)

    upload_blob.assert_awaited_once()
    assert upload_blob.await_args is not None
    assert upload_blob.await_args.kwargs["content_length"] == len(_AUDIO)
    assert ctx.audio_blob == blob
    assert not any(
        key.startswith("audio/") and value[0] == staged.key
        for key, value in storage.promoted.items()
    )
    assert staged.key not in storage.staged_objects


async def test_settle_failure_deletes_the_staged_object(
    db_session: AsyncSession,
) -> None:
    storage = _mock_storage()
    staged = StagedUploadKey(upload_id="u-empty", extension="wav")
    storage.staged_objects[staged.key] = b""
    ctx = _staged_ctx("u-empty")

    with pytest.raises(Exception, match="empty"):
        await _settle_staged_audio(ctx)

    assert staged.key not in storage.staged_objects
    assert ctx.audio_file_id == ""


def _staged_ctx(
    upload_id: str,
    *,
    visibility: str = "public",
    support_gate: dict | None = None,
) -> UploadContext:
    return UploadContext(
        upload_id=upload_id,
        auth_session=_ArtistSession(),
        audio_file_id="",
        filename="song.wav",
        duration=None,
        title="song",
        artist_did="did:test:artist",
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        support_gate=support_gate,
        visibility=visibility,
        staged=True,
    )


@pytest.mark.parametrize(
    "override,expected_private", [(None, True), ("open", False), ("off", True)]
)
@pytest.mark.parametrize("rights", [None, "{}"])
@pytest.mark.parametrize("source", ["portal", "album", "album_name"])
async def test_upload_storage_resolves_artist_download_default(
    db_session: AsyncSession,
    override: str | None,
    expected_private: bool,
    rights: str | None,
    source: str,
) -> None:
    session = _ArtistSession("did:test:inherit-downloads")
    db_session.add(
        Artist(did=session.did, handle=session.handle, display_name="Artist")
    )
    await db_session.flush()
    db_session.add(
        UserPreferences(
            did=session.did, publishing_defaults={"access": {"downloads": "off"}}
        )
    )
    await db_session.commit()
    album = None
    if source in ("album", "album_name"):
        album = Album(
            artist_did=session.did,
            title="Album",
            slug="album",
            publishing_defaults={"access": {"downloads": "supporters"}},
        )
        db_session.add(album)
        await db_session.commit()
    meta = await parse_upload_metadata(
        session,
        filename="song.mp3",
        title="Song",
        album=album.title if album and source == "album_name" else None,
        album_id=album.id if album and source == "album" else None,
        features=None,
        tags=None,
        accept_plyr_storage=True,
        publishing=json.dumps({"access": {"downloads": override}})
        if override
        else None,
        copyright=rights,
        description=None,
        self_labels=None,
        auto_tag=None,
    )
    assert meta.private_audio is expected_private
    assert meta.support_gate is None
    assert meta.download_policy == (override or ("supporters" if album else "off"))
    assert meta.policy_origin == (
        "track" if override else "album" if album else "portal"
    )
    assert meta.visibility == "public"


def test_protected_transfer_requires_explicit_storage_acceptance(
    artist_app: FastAPI,
) -> None:
    with TestClient(artist_app) as client:
        upload = _start(client)
        _send_parts(client, upload["upload_id"])
        response = client.post(
            f"/tracks/uploads/{upload['upload_id']}/finish",
            data={
                "title": "song",
                "publishing": json.dumps({"access": {"downloads": "off"}}),
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "plyr_storage_acceptance_required"
        state = client.get(f"/tracks/uploads/{upload['upload_id']}")
        assert state.status_code == 200
        assert state.json()["received_parts"] == [1, 2, 3]


def test_capable_pds_cannot_bypass_scope_with_storage_acceptance(
    artist_app: FastAPI,
) -> None:
    capability._capabilities["https://test.pds"] = True
    with TestClient(artist_app) as client:
        upload = _start(client)
        _send_parts(client, upload["upload_id"])
        response = client.post(
            f"/tracks/uploads/{upload['upload_id']}/finish",
            data={
                "title": "song",
                "publishing": json.dumps({"access": {"downloads": "off"}}),
                "accept_plyr_storage": "true",
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "permissioned_scope_required"


async def test_direct_protected_pds_transfer_refreshes_the_pending_job(
    artist_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checked: list[str] = []
    blob = {
        "$type": "blob",
        "ref": {"$link": "bafksource"},
        "mimeType": "audio/mpeg",
        "size": len(_AUDIO),
    }

    async def transfer(
        session: Session,
        *,
        body_factory: Callable[[], AsyncIterable[bytes]],
        content_length: int,
        content_type: str,
        heartbeat: Callable[[], Awaitable[None]],
    ) -> dict:
        assert content_length == len(_AUDIO)
        assert b"".join([chunk async for chunk in body_factory()]) == _AUDIO
        async with database_session() as db:
            job = await db.scalar(select(Job).where(Job.owner_did == session.did))
            assert job is not None
            job_id = job.id
            assert job.status == JobStatus.PENDING.value
            stale = datetime.now(UTC) - timedelta(minutes=20)
            await db.execute(
                update(Job).where(Job.id == job_id).values(updated_at=stale)
            )
            await db.commit()
        await heartbeat()
        refreshed = await job_service.get_job(job_id)
        assert refreshed is not None
        assert refreshed.updated_at > stale + timedelta(minutes=10)
        checked.append(job_id)
        return blob

    async def supported(session: Session) -> bool:
        return True

    monkeypatch.setattr(
        "backend.api.tracks.uploads.protected_storage_choice", supported
    )
    monkeypatch.setattr("backend.api.tracks.uploads.upload_blob", transfer)
    monkeypatch.setattr(
        "backend.api.tracks.uploads.publish_protected_blob",
        AsyncMock(return_value={"record_uri": "at://protected", "audio_blob": blob}),
    )
    monkeypatch.setattr("backend.api.tracks.uploads.schedule_track_upload", AsyncMock())
    with TestClient(artist_app) as client:
        response = client.post(
            "/tracks/",
            files={"file": ("song.mp3", _AUDIO, "audio/mpeg")},
            data={
                "title": "song",
                "publishing": json.dumps({"access": {"downloads": "off"}}),
            },
        )
    assert response.status_code == 200, response.text
    assert checked == [response.json()["upload_id"]]

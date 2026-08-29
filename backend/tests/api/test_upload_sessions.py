"""resumable upload sessions: start → parts → finish.

drives the real endpoints against the in-memory multipart store in
`MockStorage`; only the docket enqueue is mocked.
"""

import hashlib
from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

import backend.storage
from backend._internal import Session, require_artist_profile
from backend._internal.jobs import job_service
from backend.api.tracks.uploads import UploadContext, _settle_staged_audio
from backend.models.job import JobStatus, JobType
from backend.storage.keys import StagedUploadKey

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


def test_session_round_trip_enqueues_a_staged_upload(artist_app: FastAPI) -> None:
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
            data={"title": "song", "visibility": "public", "tags": '["a"]'},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["upload_id"] == upload_id

    schedule.assert_awaited_once()
    assert schedule.await_args is not None
    ctx: UploadContext = schedule.await_args.args[0]
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
            data={"title": "song", "visibility": "sideways"},
        )
        assert resp.status_code == 400
        assert "invalid visibility" in resp.json()["detail"]
        assert client.get(f"/tracks/uploads/{upload_id}").json()["received_parts"] == [
            1,
            2,
            3,
        ]


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


async def test_settle_gated_upload_lands_in_the_private_bucket(
    db_session: AsyncSession,
) -> None:
    storage = _mock_storage()
    staged = StagedUploadKey(upload_id="u-gated", extension="wav")
    storage.staged_objects[staged.key] = _AUDIO
    ctx = _staged_ctx("u-gated", support_gate={"type": "any"})

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

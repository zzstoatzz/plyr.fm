"""An account pause stops audio writes without taking away existing tracks."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import backend.storage
from backend._internal import (
    Session,
    require_artist_profile,
    require_auth,
    upload_policy,
)
from backend._internal.jobs import job_service
from backend.api.tracks.uploads import UploadContext, _process_upload_background
from backend.config import settings
from backend.models import Artist, Track
from backend.models.job import Job, JobStatus, JobType
from backend.storage.keys import StagedUploadKey

PAUSED_DID = "did:plc:so3ysj7gypel6w7mixdfjhkh"


@pytest.fixture
def upload_session() -> Session:
    return Session(
        session_id="pause-test",
        did=PAUSED_DID,
        handle="renamed.example.com",
        oauth_session={"scope": "atproto transition:generic"},
    )


@pytest.fixture
async def existing_track(db_session: AsyncSession) -> Track:
    db_session.add(Artist(did=PAUSED_DID, handle="addline.test", display_name="A"))
    await db_session.flush()
    track = Track(
        title="existing mix",
        artist_did=PAUSED_DID,
        file_id="existing-audio",
        file_type="mp3",
        r2_url="https://audio.plyr.fm/existing.mp3",
        extra={"duration": 3600},
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.fixture
def paused_app(
    fastapi_app: FastAPI, db_session: AsyncSession, upload_session: Session
) -> Generator[FastAPI, None, None]:
    async def authenticated() -> Session:
        return upload_session

    fastapi_app.dependency_overrides[require_auth] = authenticated
    fastapi_app.dependency_overrides[require_artist_profile] = authenticated
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


async def test_audio_entrypoints_refuse_before_creating_jobs(
    paused_app: FastAPI, db_session: AsyncSession, existing_track: Track
) -> None:
    with TestClient(paused_app) as client:
        responses = [
            client.post(
                "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
            ),
            client.post(
                "/tracks/", data={"title": "mix"}, files={"file": ("mix.wav", b"test")}
            ),
            client.put(
                f"/tracks/{existing_track.id}/audio",
                files={"file": ("mix.wav", b"test")},
            ),
        ]
        for response in responses:
            assert response.status_code == 403, response.text
            assert response.json()["detail"] == upload_policy.UPLOAD_PAUSE_MESSAGE
        assert (
            client.get("/tracks/me/upload-summary").json()["upload_pause_message"]
            == upload_policy.UPLOAD_PAUSE_MESSAGE
        )
        response = client.get(f"/tracks/{existing_track.id}")
        assert response.status_code == 200, response.text
        assert response.json()["title"] == "existing mix"
    assert await db_session.scalar(select(func.count()).select_from(Job)) == 0
    await db_session.refresh(existing_track)
    assert existing_track.file_id == "existing-audio"


async def test_open_transfer_can_be_read_but_not_continued(
    paused_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    with TestClient(paused_app) as client:
        with monkeypatch.context() as allowed:
            allowed.setattr(upload_policy, "PAUSED_UPLOAD_DIDS", frozenset())
            started = client.post(
                "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
            )
            assert started.status_code == 200, started.text
            upload_id = started.json()["upload_id"]
            assert (
                client.put(
                    f"/tracks/uploads/{upload_id}/parts/1", content=b"test"
                ).status_code
                == 200
            )
        response = client.put(f"/tracks/uploads/{upload_id}/parts/1", content=b"more")
        assert response.status_code == 403
        response = client.post(
            f"/tracks/uploads/{upload_id}/finish", data={"title": "mix"}
        )
        assert response.status_code == 403
        assert client.get(f"/tracks/uploads/{upload_id}").status_code == 200
    job = await job_service.get_job(upload_id)
    assert job is not None
    assert job.status == JobStatus.PENDING.value


def test_other_accounts_can_start_uploads_even_with_the_same_handle(
    paused_app: FastAPI, upload_session: Session
) -> None:
    upload_session.did = "did:plc:unaffected"
    upload_session.handle = "addline.selfhosted.social"
    with TestClient(paused_app) as client:
        response = client.post(
            "/tracks/uploads", json={"filename": "song.wav", "size_bytes": 4}
        )
        assert response.status_code == 200, response.text
        assert (
            client.get("/tracks/me/upload-summary").json()["upload_pause_message"]
            is None
        )


def test_another_did_can_be_added_to_the_pause_list(
    paused_app: FastAPI, upload_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload_session.did = "did:plc:another"
    monkeypatch.setattr(
        upload_policy,
        "PAUSED_UPLOAD_DIDS",
        upload_policy.PAUSED_UPLOAD_DIDS | {upload_session.did},
    )
    with TestClient(paused_app) as client:
        response = client.post(
            "/tracks/uploads", json={"filename": "mix.wav", "size_bytes": 4}
        )
        assert response.status_code == 403


async def test_queued_upload_fails_and_cleans_staged_bytes(
    db_session: AsyncSession, upload_session: Session
) -> None:
    upload_id = await job_service.create_job(JobType.UPLOAD, PAUSED_DID, "queued")
    key = StagedUploadKey(upload_id=upload_id, extension="wav")
    multipart_id = await backend.storage.storage.begin_staged_upload(key)
    await backend.storage.storage.put_staged_part(key, multipart_id, 1, b"audio")
    await backend.storage.storage.complete_staged_upload(key, multipart_id)
    ctx = UploadContext(
        upload_id=upload_id,
        auth_session=upload_session,
        artist_did=PAUSED_DID,
        audio_file_id="",
        filename="mix.wav",
        duration=None,
        title="mix",
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        image_id=None,
        image_url=None,
        thumbnail_url=None,
        support_gate=None,
        staged=True,
    )
    await _process_upload_background(ctx)
    job = await job_service.get_job(upload_id)
    assert job is not None
    assert job.status == JobStatus.FAILED.value
    assert job.error == upload_policy.UPLOAD_PAUSE_MESSAGE
    assert await db_session.scalar(select(func.count()).select_from(Track)) == 0
    with pytest.raises(KeyError):
        async for _ in backend.storage.storage.stream_staged(key):
            pytest.fail("paused upload left staged bytes behind")


async def test_existing_audio_still_redirects_to_storage(
    paused_app: FastAPI, existing_track: Track
) -> None:
    with TestClient(paused_app) as client:
        response = client.get(
            f"/audio/{existing_track.file_id}", follow_redirects=False
        )
        assert response.status_code == 307, response.text
        assert response.headers["location"] == existing_track.r2_url


async def test_tag_suggestions_use_cache_without_new_inference(
    paused_app: FastAPI,
    db_session: AsyncSession,
    existing_track: Track,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.replicate, "enabled", True)
    with TestClient(paused_app) as client:
        response = client.get(f"/tracks/{existing_track.id}/recommended-tags")
        assert response.status_code == 200, response.text
        assert response.json()["available"] is False
        existing_track.extra = {
            **existing_track.extra,
            "genre_predictions": [{"name": "house", "confidence": 0.9}],
            "genre_predictions_file_id": existing_track.file_id,
        }
        await db_session.commit()
        response = client.get(f"/tracks/{existing_track.id}/recommended-tags")
        assert response.status_code == 200, response.text
        assert response.json()["tags"] == [{"name": "house", "score": 0.9}]

"""Paused accounts cannot trigger processing through queued jobs or the firehose."""

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.auth import create_session
from backend._internal.clients import moderation
from backend._internal.jobs import job_service
from backend._internal.moderation import scan_track_for_copyright
from backend._internal.tasks.ingest import ingest_track_create, ingest_track_update
from backend._internal.tasks.ml import classify_genres, generate_embedding
from backend._internal.tasks.pds_mirror import mirror_pds_blob
from backend.api.tracks.audio_optimize import optimize_track_audio
from backend.api.tracks.audio_replace import ReplaceContext, _process_replace_background
from backend.config import settings
from backend.models import Artist, CopyrightScan, Track
from backend.models.job import Job, JobStatus, JobType

DID = "did:plc:so3ysj7gypel6w7mixdfjhkh"
URI = f"at://{DID}/fm.plyr.track/existing"


@pytest.fixture
async def track(db_session: AsyncSession) -> Track:
    db_session.add(
        Artist(
            did=DID,
            handle="addline.test",
            display_name="A",
            pds_url="https://pds.example.com",
        )
    )
    await db_session.flush()
    track = Track(
        title="existing",
        artist_did=DID,
        file_id="old",
        file_type="mp3",
        r2_url="https://audio.plyr.fm/old.mp3",
        pds_blob_cid="bafyold",
        audio_storage="both",
        atproto_record_uri=URI,
        extra={"duration": 3600},
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.fixture
def requests(monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    original_client = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/internal/indexing-decisions":
            return httpx.Response(200, json={"decisions": {URI: None}})
        raise AssertionError(
            f"unexpected network request: {request.method} {request.url.path}"
        )

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return original_client(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setattr(
        moderation,
        "_client",
        moderation.ModerationClient(
            service_url="https://moderation.test",
            labeler_url="https://moderation.test",
            auth_token="test",
            timeout_seconds=5,
            label_cache_prefix="test:pause:",
            label_cache_ttl_seconds=60,
        ),
    )
    return seen


def audio_record() -> dict[str, Any]:
    return {
        "title": "new title",
        "artist": "A",
        "fileType": "mp3",
        "duration": 7200,
        "audioBlob": {"ref": {"$link": "bafynew"}, "mimeType": "audio/mpeg"},
        "createdAt": datetime.now(UTC).isoformat(),
        "supportGate": {"type": "any"},
    }


async def test_firehose_cannot_add_audio(
    db_session: AsyncSession, track: Track, requests: list[httpx.Request]
) -> None:
    await ingest_track_create(
        DID, "new", audio_record(), URI.replace("existing", "new"), "newcid"
    )
    assert await db_session.scalar(select(func.count()).select_from(Track)) == 1
    assert requests == []


async def test_firehose_edits_preserve_audio_but_allow_metadata_and_access_changes(
    db_session: AsyncSession, track: Track, requests: list[httpx.Request]
) -> None:
    await ingest_track_update(DID, "existing", audio_record(), URI, "newcid")
    await db_session.refresh(track)
    assert track.title == "new title"
    assert track.support_gate == {"type": "any"}
    assert track.r2_url == "https://audio.plyr.fm/old.mp3"
    assert track.pds_blob_cid == "bafyold"
    assert track.extra["duration"] == 3600
    assert [r.url.path for r in requests] == ["/internal/indexing-decisions"]


async def test_queued_paid_jobs_make_no_provider_requests(
    db_session: AsyncSession,
    track: Track,
    requests: list[httpx.Request],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.moderation, "enabled", True)
    monkeypatch.setattr(settings.moderation, "auth_token", "test")
    monkeypatch.setattr(settings.modal, "enabled", True)
    monkeypatch.setattr(settings.turbopuffer, "enabled", True)
    monkeypatch.setattr(settings.replicate, "enabled", True)
    await scan_track_for_copyright(track.id, "https://audio.plyr.fm/old.mp3")
    await generate_embedding(track.id, "https://audio.plyr.fm/old.mp3")
    await classify_genres(track.id, "https://audio.plyr.fm/old.mp3")
    assert requests == []
    assert await db_session.scalar(select(func.count()).select_from(CopyrightScan)) == 0
    await db_session.refresh(track)
    assert "genre_predictions" not in track.extra


async def test_queued_mirror_does_not_fetch_audio(
    db_session: AsyncSession, track: Track, requests: list[httpx.Request]
) -> None:
    track.r2_url = None
    track.audio_storage = "pds"
    await db_session.commit()
    await mirror_pds_blob(track.id)
    assert requests == []
    await db_session.refresh(track)
    assert track.r2_url is None


async def test_queued_replace_keeps_existing_audio(
    db_session: AsyncSession, track: Track, requests: list[httpx.Request]
) -> None:
    job_id = await job_service.create_job(JobType.UPLOAD, DID, "queued")
    session = Session(
        session_id="pause", did=DID, handle="addline.test", oauth_session={}
    )
    await _process_replace_background(
        ReplaceContext(
            job_id=job_id,
            auth_session=session,
            track_id=track.id,
            audio_file_id="new-staged",
            filename="new.wav",
            duration=7200,
            is_gated=False,
        )
    )
    job = await job_service.get_job(job_id)
    assert job is not None
    assert job.status == JobStatus.FAILED.value
    assert job.error is not None and "temporarily paused" in job.error
    await db_session.refresh(track)
    assert track.file_id == "old"
    assert requests == []


async def test_queued_optimization_leaves_existing_rendition_available(
    db_session: AsyncSession, track: Track, requests: list[httpx.Request]
) -> None:
    track.file_type = "wav"
    track.original_file_id = "original"
    track.original_file_type = "flac"
    await db_session.commit()
    session_id = await create_session(DID, "addline.test", {})
    await optimize_track_audio(track.id, session_id)
    assert await db_session.scalar(select(func.count()).select_from(Job)) == 0
    await db_session.refresh(track)
    assert track.file_id == "old"
    assert requests == []

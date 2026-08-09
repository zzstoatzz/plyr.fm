"""unit tests for the SSE upload-progress endpoint field whitelist.

regression coverage for the issue where atproto_uri and atproto_cid
were written to job.result by the upload pipeline but never surfaced
to the SSE stream because the endpoint whitelisted only track_id and
warnings. caught by staging integration tests after #1260 merged.
"""

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.main import app
from backend.models.job import Job, JobStatus, JobType


def _make_completed_job(
    *,
    job_id: str = "test-upload-abc",
    track_id: int = 42,
    atproto_uri: str | None = "at://did:plc:test/fm.plyr.track/abc",
    atproto_cid: str | None = "bafyTestCid",
    warnings: list[str] | None = None,
    pds_blob_failed: bool = False,
) -> Job:
    """build a Job row with a completed upload and an arbitrary result dict."""
    now = datetime.now(UTC)
    result: dict = {"track_id": track_id}
    if atproto_uri is not None:
        result["atproto_uri"] = atproto_uri
    if atproto_cid is not None:
        result["atproto_cid"] = atproto_cid
    if warnings:
        result["warnings"] = warnings
    if pds_blob_failed:
        result["pds_blob_failed"] = True

    job = Job(
        id=job_id,
        type=JobType.UPLOAD.value,
        owner_did="did:plc:test",
        status=JobStatus.COMPLETED.value,
        message="upload completed successfully",
        progress_pct=100.0,
        phase="atproto",
        result=result,
        error=None,
        created_at=now,
        completed_at=now,
    )
    return job


async def _read_first_completed_event(test_app: FastAPI, upload_id: str) -> dict:
    """hit the SSE endpoint once, parse the first `data:` frame, return its JSON."""
    async with (
        AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client,
        client.stream("GET", f"/tracks/uploads/{upload_id}/progress") as response,
    ):
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if line.startswith("data: "):
                return json.loads(line[6:])
    raise AssertionError("SSE stream closed without emitting a data frame")


@pytest.fixture
def progress_app() -> FastAPI:
    """the app under test doesn't require auth on the progress endpoint."""
    return app


async def test_sse_payload_surfaces_atproto_strongref(progress_app: FastAPI):
    """atproto_uri and atproto_cid written to job.result MUST appear in the
    SSE completion payload so album upload callers can build finalize
    requests or any future consumer can grab the PDS strongRef without a
    follow-up DB query.

    regression: the endpoint previously whitelisted only track_id and
    warnings, silently dropping the strongRef fields the upload pipeline
    writes to job.result. the frontend UploadResult type and the docs
    both promise these fields — the SSE handler has to deliver them.
    """
    job = _make_completed_job()

    with patch(
        "backend.api.tracks.uploads.job_service.get_job",
        new=AsyncMock(return_value=job),
    ):
        payload = await _read_first_completed_event(progress_app, job.id)

    assert payload["status"] == "completed"
    assert payload["track_id"] == 42
    assert payload["atproto_uri"] == "at://did:plc:test/fm.plyr.track/abc"
    assert payload["atproto_cid"] == "bafyTestCid"


async def test_sse_payload_omits_absent_strongref(progress_app: FastAPI):
    """if the job.result doesn't have atproto_uri/atproto_cid (e.g. legacy
    jobs or failures), the SSE payload must not invent them — absent keys
    stay absent, no None pollution."""
    job = _make_completed_job(atproto_uri=None, atproto_cid=None)

    with patch(
        "backend.api.tracks.uploads.job_service.get_job",
        new=AsyncMock(return_value=job),
    ):
        payload = await _read_first_completed_event(progress_app, job.id)

    assert payload["status"] == "completed"
    assert payload["track_id"] == 42
    assert "atproto_uri" not in payload
    assert "atproto_cid" not in payload


async def test_sse_payload_preserves_warnings_alongside_strongref(
    progress_app: FastAPI,
):
    """both the warnings field and the strongRef fields must pass through
    the whitelist together without interfering with each other."""
    job = _make_completed_job(warnings=["pds blob upload timed out, used r2"])

    with patch(
        "backend.api.tracks.uploads.job_service.get_job",
        new=AsyncMock(return_value=job),
    ):
        payload = await _read_first_completed_event(progress_app, job.id)

    assert payload["track_id"] == 42
    assert payload["atproto_uri"] == "at://did:plc:test/fm.plyr.track/abc"
    assert payload["atproto_cid"] == "bafyTestCid"
    assert payload["warnings"] == ["pds blob upload timed out, used r2"]


async def test_sse_payload_surfaces_pds_blob_failed_flag(progress_app: FastAPI):
    """the structured pds_blob_failed flag must reach the SSE payload so the
    frontend can attach a portal deep-link to the failure toast, and must
    stay absent when the blob uploaded fine."""
    failed = _make_completed_job(
        warnings=["couldn't upload to your PDS"], pds_blob_failed=True
    )
    with patch(
        "backend.api.tracks.uploads.job_service.get_job",
        new=AsyncMock(return_value=failed),
    ):
        payload = await _read_first_completed_event(progress_app, failed.id)
    assert payload["pds_blob_failed"] is True

    ok = _make_completed_job()
    with patch(
        "backend.api.tracks.uploads.job_service.get_job",
        new=AsyncMock(return_value=ok),
    ):
        payload = await _read_first_completed_event(progress_app, ok.id)
    assert "pds_blob_failed" not in payload

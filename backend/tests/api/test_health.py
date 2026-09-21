from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models.job import Job


@pytest.fixture(autouse=True)
async def clean_backdated_jobs(db_session: AsyncSession) -> AsyncIterator[None]:
    yield
    await db_session.execute(
        delete(Job).where(Job.owner_did == "did:plc:health-private-owner")
    )
    await db_session.commit()


async def seed_job(
    db: AsyncSession,
    *,
    job_type: str = "upload",
    status: str = "processing",
    phase: str | None = None,
    age: timedelta = timedelta(),
    created_age: timedelta = timedelta(days=1),
) -> Job:
    now = datetime.now(UTC)
    job = Job(
        type=job_type,
        status=status,
        phase=phase,
        owner_did="did:plc:health-private-owner",
        message="private filename.wav",
        error="private upstream error" if status == "failed" else None,
        created_at=now - created_age,
        updated_at=now - age,
        completed_at=now - age if status in ("completed", "failed") else None,
    )
    db.add(job)
    await db.commit()
    return job


async def test_quiet_pipeline_is_healthy(
    client: TestClient, db_session: AsyncSession
) -> None:
    response = client.get("/health/freshness")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["checks"]["database"]["status"] == "ok"
    for kind in ("upload", "optimize"):
        check = response.json()["checks"][kind]
        assert check["active"] == check["stalled"] == 0
        assert check["oldest_progress_age_seconds"] is None


@pytest.mark.parametrize("status", ["pending", "processing"])
@pytest.mark.parametrize("phase", [None, "queued", "transcode"])
async def test_stalled_upload_is_503_without_changing_job(
    client: TestClient, db_session: AsyncSession, status: str, phase: str | None
) -> None:
    job = await seed_job(
        db_session, status=status, phase=phase, age=timedelta(minutes=11)
    )
    old_updated_at = job.updated_at
    response = client.get("/health/freshness")
    assert response.status_code == 503
    check = response.json()["checks"]["upload"]
    assert check["active"] == check["stalled"] == 1
    assert check["oldest_progress_age_seconds"] >= 660
    assert "private" not in response.text
    assert job.id not in response.text
    await db_session.refresh(job)
    assert job.status == status
    assert job.updated_at == old_updated_at
    assert client.get("/health").json() == {"status": "ok"}


async def test_progress_and_browser_transfers_do_not_alert(
    client: TestClient, db_session: AsyncSession
) -> None:
    await seed_job(db_session, age=timedelta(seconds=5), created_age=timedelta(days=2))
    await seed_job(
        db_session, status="pending", phase="transfer", age=timedelta(days=2)
    )
    await seed_job(db_session, job_type="export", age=timedelta(days=2))
    response = client.get("/health/freshness")
    assert response.status_code == 200
    check = response.json()["checks"]["upload"]
    assert check["active"] == check["transferring"] == 1
    assert check["stalled"] == 0
    assert check["oldest_progress_age_seconds"] < 60


async def test_processing_transfer_phase_still_requires_progress(
    client: TestClient, db_session: AsyncSession
) -> None:
    await seed_job(db_session, phase="transfer", age=timedelta(minutes=11))
    assert client.get("/health/freshness").status_code == 503


async def test_optimization_respects_its_longer_timeout(
    client: TestClient, db_session: AsyncSession
) -> None:
    limit = settings.transcoder.optimize_timeout_seconds + 600
    job = await seed_job(
        db_session, job_type="optimize", age=timedelta(seconds=limit - 60)
    )
    assert client.get("/health/freshness").status_code == 200
    job.updated_at = datetime.now(UTC) - timedelta(seconds=limit + 60)
    await db_session.commit()
    response = client.get("/health/freshness")
    assert response.status_code == 503
    assert response.json()["checks"]["optimize"]["stalled"] == 1


async def test_terminal_outcomes_are_bounded_context(
    client: TestClient, db_session: AsyncSession
) -> None:
    for status in ("completed", "failed"):
        await seed_job(db_session, status=status, age=timedelta(hours=1))
        await seed_job(db_session, status=status, age=timedelta(days=2))
    response = client.get("/health/freshness")
    assert response.status_code == 200
    check = response.json()["checks"]["upload"]
    assert check["completed_last_24h"] == check["failed_last_24h"] == 1
    assert check["active"] == check["stalled"] == 0


async def test_database_unavailable_is_sanitized_503(
    client: TestClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        settings.database,
        "url",
        "postgresql+asyncpg://health:private-password@localhost:1/missing",
    )
    response = client.get("/health/freshness")
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": {"status": "unavailable"}}
    assert "private-password" not in response.text
    assert client.get("/health").status_code == 200


async def test_blocked_database_probe_times_out_and_recovers(
    client: TestClient, db_session: AsyncSession
) -> None:
    await db_session.execute(text("LOCK TABLE jobs IN ACCESS EXCLUSIVE MODE"))
    try:
        response = client.get("/health/freshness")
        assert response.status_code == 503
        assert response.json()["checks"]["database"]["status"] == "unavailable"
    finally:
        await db_session.rollback()
    assert client.get("/health/freshness").status_code == 200
    assert (await db_session.execute(select(Job))).all() == []

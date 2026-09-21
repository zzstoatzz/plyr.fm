"""Read-only upload progress checks for fleet monitoring."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError

from backend.config import settings
from backend.models.job import Job, JobStatus, JobType
from backend.utilities.database import db_session

router = APIRouter()
PROBE_TIMEOUT_SECONDS = 3
UPLOAD_STALE_SECONDS = 600


async def upload_progress(now: datetime) -> dict[str, Any]:
    active = Job.status.in_((JobStatus.PENDING.value, JobStatus.PROCESSING.value))
    transfer = and_(Job.status == JobStatus.PENDING.value, Job.phase == "transfer")
    working = and_(active, or_(Job.phase.is_(None), ~transfer))
    thresholds = {
        JobType.UPLOAD.value: UPLOAD_STALE_SECONDS,
        JobType.OPTIMIZE.value: settings.transcoder.optimize_timeout_seconds
        + UPLOAD_STALE_SECONDS,
    }
    checks: dict[str, Any] = {}
    async with db_session() as db:
        for job_type, stale_seconds in thresholds.items():
            row = (
                await db.execute(
                    select(
                        func.count().filter(working).label("active"),
                        func.min(Job.updated_at).filter(working).label("oldest"),
                        func.count()
                        .filter(
                            working,
                            Job.updated_at < now - timedelta(seconds=stale_seconds),
                        )
                        .label("stalled"),
                        func.count().filter(transfer).label("transferring"),
                        func.count()
                        .filter(Job.status == JobStatus.COMPLETED.value)
                        .label("completed"),
                        func.count()
                        .filter(Job.status == JobStatus.FAILED.value)
                        .label("failed"),
                    ).where(
                        Job.type == job_type,
                        or_(active, Job.completed_at >= now - timedelta(hours=24)),
                    )
                )
            ).one()
            checks[job_type] = {
                "status": "degraded" if row.stalled else "ok",
                "active": row.active,
                "stalled": row.stalled,
                "oldest_progress_age_seconds": (
                    max(0, int((now - row.oldest).total_seconds()))
                    if row.oldest is not None
                    else None
                ),
                "stale_after_seconds": stale_seconds,
                "transferring": row.transferring,
                "completed_last_24h": row.completed,
                "failed_last_24h": row.failed,
            }
    return checks


@router.get("/health/freshness")
async def freshness() -> JSONResponse:
    """Check database access and upload backlog without changing job state."""
    now = datetime.now(UTC)
    try:
        async with asyncio.timeout(PROBE_TIMEOUT_SECONDS):
            checks = await upload_progress(now)
    except (SQLAlchemyError, OSError, TimeoutError):
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "checked_at": now.isoformat(),
                "checks": {"database": {"status": "unavailable"}},
            },
            headers={"Cache-Control": "no-store"},
        )
    healthy = all(check["status"] == "ok" for check in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "ok" if healthy else "degraded",
            "checked_at": now.isoformat(),
            "checks": {"database": {"status": "ok"}, **checks},
        },
        headers={"Cache-Control": "no-store"},
    )

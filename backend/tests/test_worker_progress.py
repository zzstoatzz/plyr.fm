"""Queue health uses actual due work, independent of worker heartbeats."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from docket import Docket, Worker

from backend._internal.worker_health import QUEUE_STALE_SECONDS, worker_progress
from backend.config import settings


async def harmless() -> None:
    pass


async def test_idle_future_and_overdue_work(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.docket, "name", f"health-{uuid4()}")
    async with Docket(name=settings.docket.name, url=settings.docket.url) as docket:
        docket.register(harmless)
        now = datetime.now(UTC)
        assert (await worker_progress(now))["status"] == "ok"
        await docket.add(harmless, when=now + timedelta(hours=1))()
        assert (await worker_progress(now))["status"] == "ok"
        await docket.add(harmless, when=now + timedelta(seconds=60))()
        async with Worker(docket, schedule_automatic_tasks=False):
            async with asyncio.timeout(3):
                while not await docket.workers():
                    await asyncio.sleep(0.01)
            assert len(await docket.workers()) == 1
            check = await worker_progress(
                now + timedelta(seconds=QUEUE_STALE_SECONDS + 61)
            )
            assert check["status"] == "degraded"
            assert check["overdue_scheduled"] == 1
            assert check["oldest_waiting_age_seconds"] >= QUEUE_STALE_SECONDS


async def test_ready_work_then_real_consumption(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.docket, "name", f"health-{uuid4()}")
    async with Docket(name=settings.docket.name, url=settings.docket.url) as docket:
        docket.register(harmless)
        await docket.add(harmless)()
        now = datetime.now(UTC)
        check = await worker_progress(now + timedelta(seconds=QUEUE_STALE_SECONDS + 1))
        assert check["status"] == "degraded"
        assert check["ready"]
        async with Worker(docket, schedule_automatic_tasks=False) as worker:
            await worker.run_until_finished()
        assert (await worker_progress(datetime.now(UTC)))["status"] == "ok"

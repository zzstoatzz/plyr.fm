"""Replacement scan policy through real Docket and a local moderation endpoint."""

from uuid import uuid4

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from docket import Docket, Worker
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import background
from backend._internal.clients import moderation
from backend._internal.tasks.copyright import scan_copyright, schedule_copyright_scan
from backend._internal.tasks.hooks import run_post_track_audio_replace_hooks
from backend.config import settings
from backend.models import Artist, CopyrightScan
from backend.utilities.tags import add_tags_to_track

from ._helpers import make_track


@pytest.mark.parametrize(
    ("environment", "explicit_scan", "expected_calls"),
    [("staging", False, 0), ("production", False, 1), ("staging", True, 1)],
)
async def test_replacement_scan_policy(
    db_session: AsyncSession,
    owner: Artist,
    monkeypatch: pytest.MonkeyPatch,
    environment: str,
    explicit_scan: bool,
    expected_calls: int,
) -> None:
    track = make_track(file_id="replacement")
    db_session.add(track)
    await db_session.commit()
    await add_tags_to_track(db_session, track.id, ["integration-test"], owner.did)
    db_session.add(CopyrightScan(track_id=track.id, is_flagged=True, highest_score=0))
    await db_session.commit()
    calls: list[str] = []
    monkeypatch.setattr(moderation, "_client", None)

    async def scan(request: web.Request) -> web.Response:
        assert request.headers["X-Moderation-Key"] == "local-test-key"
        calls.append((await request.json())["audio_url"])
        return web.json_response(
            {"matches": [], "highest_score": 0, "raw_response": {"status": "success"}}
        )

    app = web.Application()
    app.router.add_post("/scan", scan)
    monkeypatch.setattr(settings.observability, "environment", environment)
    monkeypatch.setattr(settings.moderation, "enabled", True)
    monkeypatch.setattr(settings.moderation, "auth_token", "local-test-key")
    monkeypatch.setattr(settings.modal, "enabled", False)
    monkeypatch.setattr(settings.replicate, "enabled", False)
    audio_url = "https://audio.example/replacement.mp3"

    async with TestServer(app) as server:
        monkeypatch.setattr(
            settings.moderation, "service_url", str(server.make_url(""))
        )
        async with Docket(
            name=f"scan-policy-{uuid4()}", url=settings.docket.url
        ) as docket:
            monkeypatch.setattr(background, "_docket", docket)
            docket.register(scan_copyright)
            await run_post_track_audio_replace_hooks(track.id, audio_url=audio_url)
            if explicit_scan:
                await schedule_copyright_scan(track.id, audio_url)
            async with Worker(docket) as worker:
                await worker.run_until_finished()

    assert calls == [audio_url] * expected_calls
    scans = (
        await db_session.scalars(
            select(CopyrightScan).where(CopyrightScan.track_id == track.id)
        )
    ).all()
    assert len(scans) == expected_calls
    assert all(not scan.is_flagged for scan in scans)

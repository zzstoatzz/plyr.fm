"""HTTP-layer tests for `PUT /tracks/{track_id}/audio`.

these are the fast, "before the upload even gets queued" checks: auth,
ownership, format validation, and the basic schedule-and-return contract.
the actual background pipeline lives in `test_pipeline.py`.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist

from ._helpers import make_track


class TestEndpointAuthAndValidation:
    """fast checks that don't exercise the background pipeline."""

    async def test_404_when_track_missing(
        self, test_app_owner: FastAPI, owner: Artist
    ) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.put(
                "/tracks/999999/audio",
                files={"file": ("new.mp3", b"\x00" * 32, "audio/mpeg")},
            )
        assert resp.status_code == 404

    async def test_403_when_not_owner(
        self,
        test_app_other: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
        other_artist: Artist,
    ) -> None:
        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_other), base_url="http://test"
        ) as client:
            resp = await client.put(
                f"/tracks/{track.id}/audio",
                files={"file": ("new.mp3", b"\x00" * 32, "audio/mpeg")},
            )
        assert resp.status_code == 403

    async def test_400_when_unsupported_format(
        self, test_app_owner: FastAPI, db_session: AsyncSession, owner: Artist
    ) -> None:
        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.put(
                f"/tracks/{track.id}/audio",
                files={
                    "file": (
                        "evil.exe",
                        b"MZ\x00\x00",
                        "application/octet-stream",
                    )
                },
            )
        assert resp.status_code == 400
        assert "unsupported" in resp.json()["detail"].lower()

    async def test_400_when_track_has_no_atproto_record(
        self, test_app_owner: FastAPI, db_session: AsyncSession, owner: Artist
    ) -> None:
        """can't replace audio on a track whose ATProto record was lost."""
        track = make_track(record_uri=None, record_cid=None)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.put(
                f"/tracks/{track.id}/audio",
                files={"file": ("new.mp3", b"\x00" * 32, "audio/mpeg")},
            )
        assert resp.status_code == 400

    async def test_returns_upload_id_and_schedules_background(
        self, test_app_owner: FastAPI, db_session: AsyncSession, owner: Artist
    ) -> None:
        """successful enqueue returns the SSE-pollable upload_id.

        the handler now stages the new audio bytes to shared object storage
        BEFORE enqueueing the docket task (so workers on other fly machines
        can pick it up without needing the request handler's /tmp). this
        test patches both stage_audio_to_storage and the docket scheduler
        so neither runs for real.
        """
        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        with (
            patch(
                "backend.api.tracks.audio_replace.stage_audio_to_storage",
                new_callable=AsyncMock,
                return_value="staged-file-id",
            ),
            patch(
                "backend.api.tracks.audio_replace.schedule_track_audio_replace",
                new_callable=AsyncMock,
            ),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=test_app_owner), base_url="http://test"
            ) as client:
                resp = await client.put(
                    f"/tracks/{track.id}/audio",
                    files={"file": ("new.mp3", b"\x00" * 32, "audio/mpeg")},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "pending"
        assert body["upload_id"]

"""live-ZDS integration coverage for permissioned private tracks.

The API and database run locally against the normal isolated test services; only
the ATProto boundary is live. The upload worker is executed inline so the test
does not need a second process, while all upload phases themselves remain real.
"""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import get_session
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.spaces.client import delete_space_record
from backend._internal.atproto.spaces.uris import parse_space_record_uri
from backend._internal.auth.app_password import create_app_password_session
from backend.api.tracks import uploads
from backend.config import settings
from backend.models import Artist, Track

pytestmark = [pytest.mark.integration, pytest.mark.timeout(120)]


def _live_zds_credentials() -> tuple[str, str, str]:
    pds = os.getenv("ZAT_TEST_PDS")
    handle = os.getenv("ZAT_TEST_HANDLE")
    password = os.getenv("ZAT_TEST_PASSWORD")
    if not all((pds, handle, password)):
        pytest.skip("live ZDS credentials are not configured")
    assert pds is not None and handle is not None and password is not None
    return pds.rstrip("/"), handle, password


def _completed_upload(response_text: str) -> dict[str, Any]:
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response_text.splitlines()
        if line.startswith("data: ")
    ]
    assert events, "upload progress returned no events"
    final = events[-1]
    assert final["status"] == "completed", final
    return final


async def test_private_track_upload_playback_and_delete_live_zds(
    fastapi_app: FastAPI,
    db_session: AsyncSession,
    drone_a4: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """upload, publish, read, range-stream, deny, and delete a private track."""
    pds, handle, password = _live_zds_credentials()
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)

    auth = await create_app_password_session(
        identifier=handle,
        app_password=password,
        pds_url=pds,
        token_name="private-media-ci",
        expires_in_days=1,
    )
    token = auth["token"]
    session = await get_session(token)
    assert session is not None

    db_session.add(
        Artist(
            did=session.did,
            handle=session.handle,
            display_name="private media integration",
            pds_url=pds,
        )
    )
    await db_session.commit()

    async def run_upload_inline(ctx: uploads.UploadContext) -> None:
        await uploads._process_upload_background(ctx)

    monkeypatch.setattr(uploads, "schedule_track_upload", run_upload_inline)

    headers = {"Authorization": f"Bearer {token}"}
    track_id: int | None = None
    record_uri: str | None = None
    title = f"private media ci {uuid4().hex}"

    try:
        async with AsyncClient(
            transport=ASGITransport(app=fastapi_app), base_url="http://test"
        ) as http:
            with drone_a4.open("rb") as audio:
                uploaded = await http.post(
                    "/tracks/",
                    headers=headers,
                    data={
                        "title": title,
                        "visibility": "private",
                        "tags": json.dumps(["integration-test", "private-media"]),
                    },
                    files={"file": (drone_a4.name, audio, "audio/wav")},
                )
            uploaded.raise_for_status()

            progress = await http.get(
                f"/tracks/uploads/{uploaded.json()['upload_id']}/progress",
                headers=headers,
            )
            progress.raise_for_status()
            completed = _completed_upload(progress.text)
            track_id = int(completed["track_id"])

            track_response = await http.get(f"/tracks/{track_id}", headers=headers)
            track_response.raise_for_status()
            track = track_response.json()
            assert track["title"] == title
            assert track["visibility"] == "private"
            assert track["audio_storage"] == "pds"
            assert track["r2_url"] is None
            assert track["pds_blob_cid"]
            assert track["atproto_record_uri"].startswith("ats://")
            record_uri = track["atproto_record_uri"]

            parsed = parse_space_record_uri(record_uri)
            stored = await make_pds_request(
                session,
                "GET",
                "com.atproto.space.getRecord",
                params={
                    "space": parsed.space,
                    "repo": parsed.author_did,
                    "collection": parsed.collection,
                    "rkey": parsed.rkey,
                },
            )
            assert stored["value"]["title"] == title

            ranged = await http.get(
                f"/audio/{track['file_id']}",
                headers={**headers, "Range": "bytes=0-3"},
            )
            assert ranged.status_code == 206, ranged.text
            assert ranged.content == b"RIFF"
            assert ranged.headers["content-range"].startswith("bytes 0-3/")

            denied = await http.get(
                f"/audio/{track['file_id']}", headers={"Range": "bytes=0-3"}
            )
            assert denied.status_code == 404

            deleted = await http.delete(f"/tracks/{track_id}", headers=headers)
            deleted.raise_for_status()

            missing = await http.get(f"/tracks/{track_id}", headers=headers)
            assert missing.status_code == 404

            with pytest.raises(Exception, match=r"404|RecordNotFound"):
                await make_pds_request(
                    session,
                    "GET",
                    "com.atproto.space.getRecord",
                    params={
                        "space": parsed.space,
                        "repo": parsed.author_did,
                        "collection": parsed.collection,
                        "rkey": parsed.rkey,
                    },
                )
    finally:
        if record_uri is not None:
            with contextlib.suppress(Exception):
                await delete_space_record(session, record_uri)
        if track_id is not None:
            await db_session.rollback()
            if leftover := await db_session.get(Track, track_id):
                await db_session.delete(leftover)
                await db_session.commit()

"""Single-track PDS saves cannot publish protected sources."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import require_auth
from backend.models import Artist, Track
from tests.api.track_audio_replace._helpers import MockSession


@pytest.mark.parametrize("source", ["r2_private", "supporters", "private"])
async def test_single_track_save_refuses_protected_audio(
    fastapi_app: FastAPI, db_session: AsyncSession, source: str
) -> None:
    artist = Artist(did="did:plc:pds-save", handle="save.test", display_name="Artist")
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        artist_did=artist.did,
        title="Protected",
        file_id="aabbccddeeff0011",
        file_type="mp3",
        audio_storage="r2_private" if source == "r2_private" else "r2",
        visibility="private" if source == "private" else "public",
        support_gate={"type": "any"} if source == "supporters" else None,
    )
    db_session.add(track)
    await db_session.commit()
    fastapi_app.dependency_overrides[require_auth] = lambda: MockSession(artist.did)
    try:
        with patch(
            "backend.api.tracks.mutations.storage.head_file",
            AsyncMock(side_effect=AssertionError("protected audio must not be read")),
        ) as read:
            async with AsyncClient(
                transport=ASGITransport(app=fastapi_app), base_url="http://test"
            ) as client:
                response = await client.post(f"/tracks/{track.id}/migrate-to-pds")
        assert response.status_code == 400, response.text
        read.assert_not_awaited()
    finally:
        fastapi_app.dependency_overrides.pop(require_auth, None)

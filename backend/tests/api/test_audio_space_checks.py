"""Only native Space audio should contact a Space authority."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from backend._internal import Session
from backend._internal.atproto.spaces.client import SpaceAccessError
from backend.api.audio import get_audio_url, stream_audio
from backend.models import Artist, Track


@pytest.mark.parametrize("endpoint", ["GET", "HEAD", "url"])
@pytest.mark.parametrize(
    "audience", ["public", "stream_only", "signed_in", "supporters", "owner", "space"]
)
async def test_space_authority_only_for_space_audio(
    db_session: AsyncSession, endpoint: str, audience: str
) -> None:
    artist = Artist(
        did=f"did:plc:space-check-{endpoint}-{audience}",
        handle="artist.test",
        display_name="Artist",
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="Space check regression",
        artist_did=artist.did,
        file_id="space-check-audio",
        file_type="mp3",
        r2_url=None if audience == "space" else "https://cdn.example.com/audio.mp3",
        audio_storage=(
            "pds"
            if audience == "space"
            else "r2"
            if audience == "public"
            else "r2_private"
        ),
        space_uri=f"at://{artist.did}/space/fm.plyr.privateMedia/self"
        if audience == "space"
        else None,
        pds_blob_cid="space-blob" if audience == "space" else None,
        download_policy="open" if audience == "public" else "off",
        visibility="private" if audience == "space" else "public",
        support_gate={"type": "any" if audience == "supporters" else audience}
        if audience in ("signed_in", "supporters", "owner")
        else None,
    )
    db_session.add(track)
    await db_session.commit()
    session = Session(
        session_id="space-check-session",
        did="did:plc:space-check-listener",
        handle="listener.test",
        oauth_session={},
    )
    authority = AsyncMock(side_effect=SpaceAccessError("UserNotAuthorized"))
    with (
        patch("backend._internal.private_access.get_space_credential", authority),
        patch(
            "backend.api.audio.validate_supporter",
            AsyncMock(return_value=SimpleNamespace(valid=False)),
        ),
        patch(
            "backend.api.audio.storage.generate_presigned_url",
            AsyncMock(return_value="https://cdn.example.com/protected.mp3"),
        ),
    ):
        if audience in ("owner", "supporters", "space"):
            with pytest.raises(HTTPException) as error:
                if endpoint == "url":
                    await get_audio_url(track.file_id, session)
                else:
                    await stream_audio(
                        track.file_id,
                        Request({"type": "http", "method": endpoint}),
                        session,
                    )
            assert (
                error.value.status_code
                == {"space": 404, "owner": 403, "supporters": 402}[audience]
            )
        elif endpoint == "url":
            response = await get_audio_url(track.file_id, session)
            assert response.url.startswith("https://cdn.example.com/")
        else:
            response = await stream_audio(
                track.file_id, Request({"type": "http", "method": endpoint}), session
            )
            assert response.status_code == (
                200 if endpoint == "HEAD" and audience != "public" else 307
            )
    if audience == "space":
        authority.assert_awaited_once()
    else:
        authority.assert_not_awaited()

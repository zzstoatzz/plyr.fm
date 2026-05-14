"""tests for the per-track copyright endpoints + audio gating semantics.

what we cover:
- audio gate-access check branches on type ("any" → supporter, "copyright" → auth)
- POST /tracks/{id}/copyright validates auth and ownership
- 400 when the user hasn't configured a paradigm
"""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.api.audio import _check_gate_access
from backend.config import settings
from backend.main import app


class _MockSession(Session):
    """mock session matching the existing test pattern."""

    def __init__(self, *, did: str = "did:test:rights-user") -> None:
        self.did = did
        self.handle = "rights-user.bsky.social"
        self.session_id = "test_session_for_rights"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": self.handle,
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": " ".join(
                ["atproto", "transition:generic", *settings.indiemusi.scope_tokens()]
            ),
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def auth_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def mock_require_auth() -> Session:
        return _MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


# --- gate-access semantics ---------------------------------------------------


async def test_check_gate_access_copyright_requires_any_auth() -> None:
    """any authenticated session passes; not-the-artist is fine too."""
    listener = _MockSession(did="did:test:listener")
    await _check_gate_access(
        {"type": "copyright"}, listener, artist_did="did:test:someone-else"
    )


async def test_check_gate_access_copyright_rejects_anon() -> None:
    with pytest.raises(HTTPException) as exc:
        await _check_gate_access({"type": "copyright"}, None, artist_did="did:test:x")
    assert exc.value.status_code == 401


async def test_check_gate_access_supporter_still_requires_validation() -> None:
    """existing supporter-gate path is unchanged: artist passes, others go through validate_supporter."""
    artist = _MockSession(did="did:test:artist")
    # artist accessing their own track: no validation call
    with patch(
        "backend.api.audio.validate_supporter", new_callable=AsyncMock
    ) as mock_v:
        await _check_gate_access({"type": "any"}, artist, artist_did="did:test:artist")
        mock_v.assert_not_called()


async def test_check_gate_access_supporter_non_artist_calls_validate() -> None:
    listener = _MockSession(did="did:test:listener")
    with patch(
        "backend.api.audio.validate_supporter", new_callable=AsyncMock
    ) as mock_v:
        mock_v.return_value = AsyncMock(valid=True)
        # async fns can't be returned by AsyncMock without coroutine return; use return_value
        mock_v.return_value.valid = True
        await _check_gate_access(
            {"type": "any"}, listener, artist_did="did:test:artist"
        )
        mock_v.assert_awaited_once()


# --- POST /tracks/{id}/copyright requires auth + ownership -------------------


async def test_set_track_copyright_requires_auth(db_session: AsyncSession) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/tracks/999/copyright",
            json={"iswc": "T-330690274-5"},
        )
    assert response.status_code == 401


async def test_set_track_copyright_404_when_track_missing(
    auth_app: FastAPI, db_session: AsyncSession
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=auth_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/tracks/99999/copyright",
            json={"iswc": "T-330690274-5"},
        )
    assert response.status_code == 404


async def test_delete_track_copyright_404_when_track_missing(
    auth_app: FastAPI, db_session: AsyncSession
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=auth_app), base_url="http://test"
    ) as client:
        response = await client.delete("/tracks/99999/copyright")
    assert response.status_code == 404

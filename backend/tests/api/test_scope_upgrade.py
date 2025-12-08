"""tests for scope upgrade OAuth flow."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id_for_upgrade"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "testuser.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


async def test_start_scope_upgrade_flow(test_app: FastAPI, db_session: AsyncSession):
    """test starting the scope upgrade OAuth flow."""
    with patch(
        "backend.api.auth.start_oauth_flow_with_scopes", new_callable=AsyncMock
    ) as mock_oauth:
        mock_oauth.return_value = (
            "https://auth.example.com/authorize?scope=teal",
            "test_state",
        )

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/scope-upgrade/start",
                json={"include_teal": True},
            )

        assert response.status_code == 200
        data = response.json()
        assert "auth_url" in data
        assert data["auth_url"].startswith("https://auth.example.com")
        mock_oauth.assert_called_once_with("testuser.bsky.social", include_teal=True)


async def test_start_scope_upgrade_default_includes_teal(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that scope upgrade defaults to including teal scopes."""
    with patch(
        "backend.api.auth.start_oauth_flow_with_scopes", new_callable=AsyncMock
    ) as mock_oauth:
        mock_oauth.return_value = ("https://auth.example.com/authorize", "test_state")

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/scope-upgrade/start",
                json={},  # empty body - should default to include_teal=True
            )

        assert response.status_code == 200
        mock_oauth.assert_called_once_with("testuser.bsky.social", include_teal=True)


async def test_scope_upgrade_requires_auth(db_session: AsyncSession):
    """test that scope upgrade requires authentication."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/scope-upgrade/start",
            json={"include_teal": True},
        )

    assert response.status_code == 401


async def test_scope_upgrade_saves_pending_record(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that starting scope upgrade saves pending record."""
    from backend._internal import get_pending_scope_upgrade

    with patch(
        "backend.api.auth.start_oauth_flow_with_scopes", new_callable=AsyncMock
    ) as mock_oauth:
        mock_oauth.return_value = ("https://auth.example.com/authorize", "test_state")

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/scope-upgrade/start",
                json={"include_teal": True},
            )

        assert response.status_code == 200

        # verify pending record was saved
        pending = await get_pending_scope_upgrade("test_state")
        assert pending is not None
        assert pending.did == "did:test:user123"
        assert pending.old_session_id == "test_session_id_for_upgrade"
        assert pending.requested_scopes == "teal"

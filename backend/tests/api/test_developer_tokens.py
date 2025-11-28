"""tests for developer token api endpoints."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, create_session, require_auth
from backend.main import app


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id"
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


async def test_start_developer_token_flow(test_app: FastAPI, db_session: AsyncSession):
    """test starting the developer token OAuth flow."""
    with patch(
        "backend.api.auth.start_oauth_flow", new_callable=AsyncMock
    ) as mock_oauth:
        mock_oauth.return_value = (
            "https://auth.example.com/authorize?...",
            "test_state",
        )

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/developer-token/start",
                json={"name": "my-token", "expires_in_days": 30},
            )

        assert response.status_code == 200
        data = response.json()
        assert "auth_url" in data
        assert data["auth_url"].startswith("https://auth.example.com")
        mock_oauth.assert_called_once_with("testuser.bsky.social")


async def test_start_developer_token_default_expiration(
    test_app: FastAPI, db_session: AsyncSession
):
    """test starting dev token flow with default expiration."""
    with patch(
        "backend.api.auth.start_oauth_flow", new_callable=AsyncMock
    ) as mock_oauth:
        mock_oauth.return_value = ("https://auth.example.com/authorize", "test_state")

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/developer-token/start",
                json={},
            )

        assert response.status_code == 200
        # verify pending dev token was saved (would fail if expiration wasn't set)


async def test_start_developer_token_exceeds_max(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that expiration cannot exceed max allowed."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token/start",
            json={"expires_in_days": 999},  # exceeds default max of 365
        )

    assert response.status_code == 400
    assert "cannot exceed" in response.json()["detail"]


async def test_start_developer_token_requires_auth(db_session: AsyncSession):
    """test that developer token start requires authentication."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token/start",
            json={},
        )

    assert response.status_code == 401


async def test_list_developer_tokens(test_app: FastAPI, db_session: AsyncSession):
    """test listing developer tokens."""
    mock_session = MockSession()

    # create a dev token directly in the database
    await create_session(
        did=mock_session.did,
        handle=mock_session.handle,
        oauth_session=mock_session.oauth_session,
        expires_in_days=30,
        is_developer_token=True,
        token_name="list-test-token",
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/auth/developer-tokens")

    assert response.status_code == 200
    data = response.json()
    assert "tokens" in data
    assert len(data["tokens"]) >= 1

    # find our token
    token = next((t for t in data["tokens"] if t["name"] == "list-test-token"), None)
    assert token is not None
    assert "session_id" in token
    assert "created_at" in token


async def test_revoke_developer_token(test_app: FastAPI, db_session: AsyncSession):
    """test revoking a developer token."""
    mock_session = MockSession()

    # create a dev token directly
    await create_session(
        did=mock_session.did,
        handle=mock_session.handle,
        oauth_session=mock_session.oauth_session,
        expires_in_days=30,
        is_developer_token=True,
        token_name="revoke-test-token",
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # list tokens to get session_id prefix
        list_response = await client.get("/auth/developer-tokens")
        assert list_response.status_code == 200
        tokens = list_response.json()["tokens"]
        token = next((t for t in tokens if t["name"] == "revoke-test-token"), None)
        assert token is not None

        # revoke the token
        revoke_response = await client.delete(
            f"/auth/developer-tokens/{token['session_id']}"
        )
        assert revoke_response.status_code == 200
        assert revoke_response.json()["message"] == "token revoked successfully"

        # verify it's gone
        final_list = await client.get("/auth/developer-tokens")
        remaining = [
            t for t in final_list.json()["tokens"] if t["name"] == "revoke-test-token"
        ]
        assert len(remaining) == 0


async def test_revoke_nonexistent_token(test_app: FastAPI, db_session: AsyncSession):
    """test revoking a token that doesn't exist."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete("/auth/developer-tokens/nonexist")

    assert response.status_code == 404
    assert response.json()["detail"] == "token not found"

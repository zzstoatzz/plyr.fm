"""tests for developer token api endpoint."""

from collections.abc import Generator

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


async def test_create_developer_token_default_expiration(
    test_app: FastAPI, db_session: AsyncSession
):
    """test creating developer token with default expiration."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token",
            json={},
        )

    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["expires_in_days"] == 90  # default
    assert "Developer token created" in data["message"]


async def test_create_developer_token_custom_expiration(
    test_app: FastAPI, db_session: AsyncSession
):
    """test creating developer token with custom expiration."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token",
            json={"expires_in_days": 30},
        )

    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["expires_in_days"] == 30
    assert "30 days" in data["message"]


async def test_create_developer_token_no_expiration(
    test_app: FastAPI, db_session: AsyncSession
):
    """test creating developer token that never expires."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token",
            json={"expires_in_days": 0},
        )

    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["expires_in_days"] == 0
    assert "never expires" in data["message"]


async def test_create_developer_token_exceeds_max(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that expiration cannot exceed max allowed."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token",
            json={"expires_in_days": 999},  # exceeds default max of 365
        )

    assert response.status_code == 400
    assert "cannot exceed" in response.json()["detail"]


async def test_create_developer_token_requires_auth(db_session: AsyncSession):
    """test that developer token creation requires authentication."""
    # use app without mocked auth
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token",
            json={},
        )

    assert response.status_code == 401


async def test_create_developer_token_with_name(
    test_app: FastAPI, db_session: AsyncSession
):
    """test creating developer token with a name."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/developer-token",
            json={"name": "my-test-token", "expires_in_days": 30},
        )

    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["expires_in_days"] == 30


async def test_list_developer_tokens(test_app: FastAPI, db_session: AsyncSession):
    """test listing developer tokens."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # first create a token
        create_response = await client.post(
            "/auth/developer-token",
            json={"name": "list-test-token"},
        )
        assert create_response.status_code == 200

        # list tokens
        list_response = await client.get("/auth/developer-tokens")

    assert list_response.status_code == 200
    data = list_response.json()
    assert "tokens" in data
    assert len(data["tokens"]) >= 1

    # find our token
    token = next((t for t in data["tokens"] if t["name"] == "list-test-token"), None)
    assert token is not None
    assert "session_id" in token
    assert "created_at" in token


async def test_revoke_developer_token(test_app: FastAPI, db_session: AsyncSession):
    """test revoking a developer token."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # create a token
        create_response = await client.post(
            "/auth/developer-token",
            json={"name": "revoke-test-token"},
        )
        assert create_response.status_code == 200

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

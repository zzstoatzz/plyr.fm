"""tests for preferences api endpoints."""

from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.main import app


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(
        self, did: str = "did:test:user123", scope: str = "atproto transition:generic"
    ):
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
            "scope": scope,
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def mock_session() -> MockSession:
    """default mock session without teal scopes."""
    return MockSession()


@pytest.fixture
def mock_session_with_teal() -> MockSession:
    """mock session with teal scopes."""
    return MockSession(
        scope=settings.atproto.resolved_scope_with_teal(
            settings.teal.play_collection, settings.teal.status_collection
        )
    )


@pytest.fixture
async def client_no_teal(
    db_session: AsyncSession,
    mock_session: MockSession,
) -> AsyncGenerator[AsyncClient, None]:
    """authenticated client without teal scopes."""
    app.dependency_overrides[require_auth] = lambda: mock_session

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture
async def client_with_teal(
    db_session: AsyncSession,
    mock_session_with_teal: MockSession,
) -> AsyncGenerator[AsyncClient, None]:
    """authenticated client with teal scopes."""
    app.dependency_overrides[require_auth] = lambda: mock_session_with_teal

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client

    app.dependency_overrides.clear()


async def test_get_preferences_includes_teal_fields(
    client_no_teal: AsyncClient,
):
    """should return teal scrobbling fields in preferences response."""
    response = await client_no_teal.get("/preferences/")
    assert response.status_code == 200

    data = response.json()
    assert "enable_teal_scrobbling" in data
    assert "teal_needs_reauth" in data
    # default should be disabled
    assert data["enable_teal_scrobbling"] is False


async def test_update_teal_scrobbling_preference(
    client_no_teal: AsyncClient,
):
    """should update teal scrobbling preference."""
    # enable teal scrobbling
    response = await client_no_teal.post(
        "/preferences/",
        json={"enable_teal_scrobbling": True},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["enable_teal_scrobbling"] is True
    # should need reauth since session doesn't have teal scopes
    assert data["teal_needs_reauth"] is True


async def test_teal_needs_reauth_false_when_disabled(
    client_no_teal: AsyncClient,
):
    """should not need reauth when teal scrobbling is disabled."""
    response = await client_no_teal.post(
        "/preferences/",
        json={"enable_teal_scrobbling": False},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["enable_teal_scrobbling"] is False
    assert data["teal_needs_reauth"] is False


async def test_teal_no_reauth_needed_with_scope(
    client_with_teal: AsyncClient,
):
    """should not need reauth when teal is enabled and scope is present."""
    # first enable teal
    await client_with_teal.post(
        "/preferences/",
        json={"enable_teal_scrobbling": True},
    )

    # then get preferences
    response = await client_with_teal.get("/preferences/")
    assert response.status_code == 200

    data = response.json()
    assert data["enable_teal_scrobbling"] is True
    # should NOT need reauth since session has teal scopes
    assert data["teal_needs_reauth"] is False


async def test_get_preferences_includes_support_url(
    client_no_teal: AsyncClient,
):
    """should return support_url field in preferences response."""
    response = await client_no_teal.get("/preferences/")
    assert response.status_code == 200

    data = response.json()
    assert "support_url" in data
    # default should be None
    assert data["support_url"] is None


async def test_set_support_url(
    client_no_teal: AsyncClient,
):
    """should update support_url preference."""
    response = await client_no_teal.post(
        "/preferences/",
        json={"support_url": "https://ko-fi.com/testartist"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["support_url"] == "https://ko-fi.com/testartist"


async def test_clear_support_url_with_empty_string(
    client_no_teal: AsyncClient,
):
    """should clear support_url when set to empty string."""
    # first set a URL
    await client_no_teal.post(
        "/preferences/",
        json={"support_url": "https://ko-fi.com/testartist"},
    )

    # then clear it with empty string
    response = await client_no_teal.post(
        "/preferences/",
        json={"support_url": ""},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["support_url"] is None


async def test_support_url_persists_after_update(
    client_no_teal: AsyncClient,
):
    """support_url should persist when updating other preferences."""
    # set support_url
    await client_no_teal.post(
        "/preferences/",
        json={"support_url": "https://patreon.com/testartist"},
    )

    # update a different preference
    response = await client_no_teal.post(
        "/preferences/",
        json={"auto_advance": False},
    )
    assert response.status_code == 200

    data = response.json()
    # support_url should still be set
    assert data["support_url"] == "https://patreon.com/testartist"
    assert data["auto_advance"] is False

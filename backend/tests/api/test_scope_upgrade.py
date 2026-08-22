"""tests for scope upgrade OAuth flow."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.main import app
from backend.models import Artist


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
        # a scope upgrade preserves every scope the session already has; this
        # session has neither indiemusi nor the permissioned-space scope.
        mock_oauth.assert_called_once_with(
            "testuser.bsky.social",
            include_teal=True,
            include_indiemusi=False,
            include_permissioned=False,
        )


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
        # a scope upgrade preserves every scope the session already has; this
        # session has neither indiemusi nor the permissioned-space scope.
        mock_oauth.assert_called_once_with(
            "testuser.bsky.social",
            include_teal=True,
            include_indiemusi=False,
            include_permissioned=False,
        )


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


# --- private-media upgrade callback: the PDS answers through the grant ---------

_GRANTED_SCOPE = (
    "atproto blob:*/* space:fm.plyr.dev.privateMedia?authority=did:test:user123"
    "&skey=self&collection=fm.plyr.dev.track&action=read&action=create"
    "&action=update&action=delete&manage=create&manage=update&manage=delete"
)
_UNEXPANDED_SCOPE = "atproto blob:*/* include:fm.plyr.dev.privateMediaAccess"


def _oauth_session(scope: str) -> dict:
    return {
        "did": "did:test:user123",
        "handle": "testuser.bsky.social",
        "pds_url": "https://test.pds",
        "authserver_iss": "https://auth.test",
        "scope": scope,
        "access_token": "t",
        "refresh_token": "r",
        "dpop_private_key_pem": "fake_key",
        "dpop_authserver_nonce": "",
        "dpop_pds_nonce": "",
    }


@pytest.fixture
async def upgrade_artist(db_session: AsyncSession) -> Artist:
    artist = Artist(
        did="did:test:user123", handle="testuser.bsky.social", display_name="t"
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


async def _run_permissioned_callback(
    test_app: FastAPI, scope: str, monkeypatch: pytest.MonkeyPatch
) -> str:
    from backend._internal import save_pending_scope_upgrade

    monkeypatch.setattr(settings.atproto, "app_namespace", "fm.plyr.dev")
    await save_pending_scope_upgrade(
        state="perm_state",
        did="did:test:user123",
        old_session_id="old_session",
        requested_scopes="permissioned",
    )
    with (
        patch(
            "backend.api.auth.handle_oauth_callback",
            new_callable=AsyncMock,
            return_value=(
                "did:test:user123",
                "testuser.bsky.social",
                _oauth_session(scope),
            ),
        ),
        patch(
            "backend.api.auth.get_pending_dev_token",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend.api.auth.ensure_artist_exists",
            new_callable=AsyncMock,
            return_value=False,
        ),
        patch("backend.api.auth.delete_session", new_callable=AsyncMock),
        patch(
            "backend.api.auth.create_session",
            new_callable=AsyncMock,
            return_value="new_session",
        ),
        patch(
            "backend.api.auth.create_exchange_token",
            new_callable=AsyncMock,
            return_value="xt",
        ),
        patch("backend.api.auth.schedule_atproto_sync", new_callable=AsyncMock),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/auth/callback",
                params={"code": "c", "state": "perm_state", "iss": "https://auth.test"},
            )
    assert response.status_code == 303
    return response.headers["location"]


async def test_permissioned_callback_with_expanded_grant_succeeds(
    test_app: FastAPI,
    db_session: AsyncSession,
    upgrade_artist: Artist,
    monkeypatch: pytest.MonkeyPatch,
):
    location = await _run_permissioned_callback(test_app, _GRANTED_SCOPE, monkeypatch)
    assert location.endswith("/settings?exchange_token=xt&scope_upgraded=true")


async def test_permissioned_callback_with_unexpanded_scope_reports_refusal(
    test_app: FastAPI,
    db_session: AsyncSession,
    upgrade_artist: Artist,
    monkeypatch: pytest.MonkeyPatch,
):
    location = await _run_permissioned_callback(
        test_app, _UNEXPANDED_SCOPE, monkeypatch
    )
    assert location.endswith("/settings?exchange_token=xt&scope_upgrade_error=refused")


async def test_permissioned_callback_invalid_scope_keeps_old_session(
    test_app: FastAPI,
    db_session: AsyncSession,
    upgrade_artist: Artist,
):
    from backend._internal import get_pending_scope_upgrade, save_pending_scope_upgrade

    await save_pending_scope_upgrade(
        state="perm_state",
        did="did:test:user123",
        old_session_id="old_session",
        requested_scopes="permissioned",
    )
    with (
        patch(
            "backend.api.auth.get_session",
            new_callable=AsyncMock,
            return_value=MockSession(),
        ),
        patch("backend.api.auth.delete_session", new_callable=AsyncMock) as delete,
        patch("backend.api.auth.handle_oauth_callback", new_callable=AsyncMock) as cb,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/auth/callback",
                params={
                    "state": "perm_state",
                    "error": "invalid_scope",
                    "error_description": "unknown scope",
                },
            )
    assert response.status_code == 303
    assert response.headers["location"].endswith(
        "/settings?scope_upgrade_error=refused"
    )
    delete.assert_not_awaited()
    cb.assert_not_awaited()
    assert await get_pending_scope_upgrade("perm_state") is None


async def test_permissioned_start_surfaces_a_par_refusal(
    test_app: FastAPI, db_session: AsyncSession, upgrade_artist: Artist
):
    """a PDS without spaces refuses at PAR, before any consent screen."""
    with patch(
        "backend.api.auth.start_oauth_flow_with_scopes",
        new_callable=AsyncMock,
        side_effect=HTTPException(
            status_code=400,
            detail=(
                "failed to start OAuth flow: invalid_scope: Permissioned data "
                "(spaces) is not enabled on this server"
            ),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/scope-upgrade/start",
                json={"include_teal": False, "include_permissioned": True},
            )

    assert response.status_code == 400
    assert response.json()["detail"] == "spaces_refused"


async def test_non_permissioned_start_failure_is_not_swallowed(
    test_app: FastAPI, db_session: AsyncSession, upgrade_artist: Artist
):
    with patch(
        "backend.api.auth.start_oauth_flow_with_scopes",
        new_callable=AsyncMock,
        side_effect=HTTPException(status_code=400, detail="invalid_scope: teal"),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/scope-upgrade/start", json={"include_teal": True}
            )

    assert response.status_code == 400
    assert "invalid_scope" in response.json()["detail"]


async def test_auth_me_supported_is_the_grant(
    test_app: FastAPI, db_session: AsyncSession, upgrade_artist: Artist
):
    """the expanded grant is the only capability signal: supported == granted."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/auth/me")
    assert response.status_code == 200
    assert response.json()["permissioned_spaces"] == {
        "supported": False,
        "granted": False,
        "reader": False,
    }

    with patch("backend.api.auth.session_has_private_media_access", return_value=True):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/auth/me")
    spaces = response.json()["permissioned_spaces"]
    assert spaces["supported"] is True and spaces["granted"] is True

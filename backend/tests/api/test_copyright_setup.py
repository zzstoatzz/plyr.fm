"""tests for the copyright paradigm setup API.

these are endpoint-level tests verifying:
- the scope-upgrade-first path: when the session lacks indiemusi scopes,
  /copyright/setup kicks off OAuth and stashes paradigm_data + redirect_to on
  the pending_scope_upgrade row
- the in-place path: when the session already has indiemusi scopes, setup
  writes the publishingOwner record + saves the config row without redirect
- bad paradigm IDs are rejected
- disconnect deletes the config row
"""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_pending_scope_upgrade, require_auth
from backend._internal.copyright import (
    delete_user_copyright_config,
    get_user_copyright_config,
    upsert_user_copyright_config,
)
from backend.config import settings
from backend.main import app


class _MockSession(Session):
    """mock session bypassing real auth — varies the granted scope per test."""

    def __init__(self, *, scope: str = "atproto transition:generic") -> None:
        self.did = "did:test:copyright-user"
        self.handle = "copyright-user.bsky.social"
        self.session_id = "test_session_for_copyright"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": self.did,
            "handle": self.handle,
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
async def _seed_copyright_flag(db_session: AsyncSession) -> None:
    """seed Artist + copyright-paradigm flag for the mock session DID.

    every endpoint test in this module exercises the in-flag path; the
    out-of-flag 404 contract is covered separately in
    test_copyright_feature_flag.py.
    """
    from backend._internal import enable_flag
    from backend.models import Artist

    did = "did:test:copyright-user"
    db_session.add(
        Artist(did=did, handle="copyright-user.bsky.social", display_name="Test")
    )
    await db_session.commit()
    await enable_flag(db_session, did, "copyright-paradigm")
    await db_session.commit()


@pytest.fixture
def app_without_scopes(
    db_session: AsyncSession, _seed_copyright_flag: None
) -> Generator[FastAPI, None, None]:
    """session has no indiemusi scopes — setup should kick off OAuth."""

    async def mock_require_auth() -> Session:
        return _MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def app_with_scopes(
    db_session: AsyncSession, _seed_copyright_flag: None
) -> Generator[FastAPI, None, None]:
    """session has indiemusi scopes — setup should complete in place."""

    indiemusi_scope = " ".join(settings.indiemusi.scope_tokens())

    async def mock_require_auth() -> Session:
        return _MockSession(scope=f"atproto transition:generic {indiemusi_scope}")

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


# --- GET /copyright/config ---------------------------------------------------


async def test_get_config_returns_null_when_unconfigured(
    app_without_scopes: FastAPI, db_session: AsyncSession
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_without_scopes), base_url="http://test"
    ) as client:
        response = await client.get("/copyright/config")

    assert response.status_code == 200
    assert response.json() is None


async def test_get_config_returns_existing(
    app_without_scopes: FastAPI, db_session: AsyncSession
) -> None:
    await upsert_user_copyright_config(
        did="did:test:copyright-user",
        paradigm=settings.indiemusi.paradigm_id,
        config_uri="at://did:test:copyright-user/ch.indiemusi.alpha.actor.publishingOwner/abc",
        paradigm_data={"firstName": "Hilke", "lastName": "Ros"},
    )
    async with AsyncClient(
        transport=ASGITransport(app=app_without_scopes), base_url="http://test"
    ) as client:
        response = await client.get("/copyright/config")

    assert response.status_code == 200
    body = response.json()
    assert body["paradigm"] == settings.indiemusi.paradigm_id
    assert body["paradigm_data"]["firstName"] == "Hilke"

    # clean up for other tests
    await delete_user_copyright_config("did:test:copyright-user")


# --- POST /copyright/setup ---------------------------------------------------


async def test_setup_without_scopes_kicks_off_oauth(
    app_without_scopes: FastAPI, db_session: AsyncSession
) -> None:
    """no indiemusi scopes yet → returns auth_url and stashes paradigm_data."""
    with patch(
        "backend.api.copyright.start_oauth_flow_with_scopes",
        new_callable=AsyncMock,
    ) as mock_oauth:
        mock_oauth.return_value = (
            "https://auth.example.com/authorize?scope=indiemusi",
            "test_state_indiemusi",
        )
        async with AsyncClient(
            transport=ASGITransport(app=app_without_scopes), base_url="http://test"
        ) as client:
            response = await client.post(
                "/copyright/setup",
                json={
                    "paradigm": settings.indiemusi.paradigm_id,
                    "publishing_owner": {
                        "firstName": "Hilke",
                        "lastName": "Ros",
                        "ipi": "01145982828",
                        "collectingSociety": "Suisa",
                    },
                },
            )

    assert response.status_code == 200
    body = response.json()
    assert body["auth_url"] == "https://auth.example.com/authorize?scope=indiemusi"
    assert body["complete"] is False
    mock_oauth.assert_called_once_with(
        "copyright-user.bsky.social", include_indiemusi=True
    )

    # pending row was stashed with paradigm_data + portal redirect
    pending = await get_pending_scope_upgrade("test_state_indiemusi")
    assert pending is not None
    assert pending.requested_scopes == "indiemusi"
    assert pending.redirect_to == "/portal"
    assert pending.paradigm_data == {
        "firstName": "Hilke",
        "lastName": "Ros",
        "ipi": "01145982828",
        "collectingSociety": "Suisa",
    }


async def test_setup_with_scopes_completes_in_place(
    app_with_scopes: FastAPI, db_session: AsyncSession
) -> None:
    """when session already has the scopes, setup writes directly + returns complete=True."""
    with patch(
        "backend.api.copyright.complete_indiemusi_setup",
        new_callable=AsyncMock,
    ) as mock_complete:
        async with AsyncClient(
            transport=ASGITransport(app=app_with_scopes), base_url="http://test"
        ) as client:
            response = await client.post(
                "/copyright/setup",
                json={
                    "paradigm": settings.indiemusi.paradigm_id,
                    "publishing_owner": {"companyName": "Red Brick Records"},
                },
            )

    assert response.status_code == 200
    body = response.json()
    assert body["auth_url"] is None
    assert body["complete"] is True
    mock_complete.assert_awaited_once()
    args = mock_complete.await_args
    assert args.args[1] == {"companyName": "Red Brick Records"}


async def test_setup_rejects_unknown_paradigm(
    app_without_scopes: FastAPI, db_session: AsyncSession
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_without_scopes), base_url="http://test"
    ) as client:
        response = await client.post(
            "/copyright/setup",
            json={
                "paradigm": "not-a-real-paradigm",
                "publishing_owner": {"firstName": "x", "lastName": "y"},
            },
        )

    assert response.status_code == 400


async def test_setup_requires_auth(db_session: AsyncSession) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/copyright/setup",
            json={
                "paradigm": settings.indiemusi.paradigm_id,
                "publishing_owner": {"firstName": "x", "lastName": "y"},
            },
        )
    assert response.status_code == 401


# --- POST /copyright/disconnect ----------------------------------------------


async def test_disconnect_clears_config(
    app_without_scopes: FastAPI, db_session: AsyncSession
) -> None:
    await upsert_user_copyright_config(
        did="did:test:copyright-user",
        paradigm=settings.indiemusi.paradigm_id,
        config_uri=None,  # no PDS-side record to delete
        paradigm_data={"firstName": "x", "lastName": "y"},
    )
    async with AsyncClient(
        transport=ASGITransport(app=app_without_scopes), base_url="http://test"
    ) as client:
        response = await client.post("/copyright/disconnect")
    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    assert await get_user_copyright_config("did:test:copyright-user") is None


async def test_disconnect_noop_when_unconfigured(
    app_without_scopes: FastAPI, db_session: AsyncSession
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_without_scopes), base_url="http://test"
    ) as client:
        response = await client.post("/copyright/disconnect")
    assert response.status_code == 200
    assert response.json() == {"deleted": False}

"""tests: every /copyright/* and /tracks/{id}/copyright endpoint is gated by
the `copyright-paradigm` feature flag.

we 404 (not 403) so we don't leak the existence of the rollout to users who
aren't enrolled — same shape unmounted endpoints have.

also locks `_check_copyright_paradigm` so a user with an extant config row
but no flag stops getting indiemusi scopes re-requested on every fresh login.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, enable_flag, require_auth
from backend._internal.auth.session import _check_copyright_paradigm
from backend._internal.copyright import upsert_user_copyright_config
from backend.config import settings
from backend.main import app
from backend.models import Artist

_TEST_DID = "did:test:copyright-flag-user"


class _MockSession(Session):
    def __init__(self) -> None:
        self.did = _TEST_DID
        self.handle = "flag-user.bsky.social"
        self.session_id = "test_session_flag"
        self.access_token = "tok"
        self.refresh_token = "ref"
        self.oauth_session = {
            "did": _TEST_DID,
            "handle": self.handle,
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto",
            "access_token": "tok",
            "refresh_token": "ref",
            "dpop_private_key_pem": "fake",
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


# --- endpoint gate ---------------------------------------------------------


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/copyright/config", None),
        (
            "POST",
            "/copyright/setup",
            {
                "paradigm": "indiemusi-alpha",
                "publishing_owner": {"firstName": "x", "lastName": "y"},
            },
        ),
        ("POST", "/copyright/disconnect", None),
        ("POST", "/tracks/9999/copyright", {}),
        ("DELETE", "/tracks/9999/copyright", None),
    ],
)
async def test_endpoints_404_without_flag(
    auth_app: FastAPI,
    db_session: AsyncSession,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    """every copyright endpoint returns 404 when the caller lacks the flag.

    404 (not 403) so the rollout boundary isn't leaked to non-enrolled users.
    """
    async with AsyncClient(
        transport=ASGITransport(app=auth_app), base_url="http://test"
    ) as client:
        if method == "GET":
            response = await client.get(path)
        elif method == "POST":
            response = await client.post(path, json=body or {})
        elif method == "DELETE":
            response = await client.delete(path)
        else:
            pytest.fail(f"unexpected method {method}")
    assert response.status_code == 404


async def test_config_passes_through_with_flag(
    auth_app: FastAPI, db_session: AsyncSession
) -> None:
    """gate raises only when the flag is missing — with it set, normal behavior
    (here: returns null because no config row exists yet)."""
    # feature_flags has an FK to artists.did, so we need the row first
    db_session.add(
        Artist(did=_TEST_DID, handle="flag-user.example", display_name="Flag User")
    )
    await db_session.commit()
    await enable_flag(db_session, _TEST_DID, "copyright-paradigm")
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=auth_app), base_url="http://test"
    ) as client:
        response = await client.get("/copyright/config")
    assert response.status_code == 200
    assert response.json() is None


# --- _check_copyright_paradigm gate ----------------------------------------


async def test_check_paradigm_false_without_flag(db_session: AsyncSession) -> None:
    """a user with a copyright config row but no flag must NOT have indiemusi
    scopes re-requested on their next sign-in — defeats the rollback if we did.
    """
    did = "did:test:opted-in-but-unflagged"
    db_session.add(Artist(did=did, handle="x.example", display_name="X"))
    await db_session.commit()
    await upsert_user_copyright_config(
        did=did,
        paradigm=settings.indiemusi.paradigm_id,
        config_uri=None,
        paradigm_data={"firstName": "x", "lastName": "y"},
    )

    assert await _check_copyright_paradigm(did) is False


async def test_check_paradigm_true_when_both_set(db_session: AsyncSession) -> None:
    """config row AND flag → re-request indiemusi scopes on login."""
    did = "did:test:opted-in-and-flagged"
    db_session.add(Artist(did=did, handle="y.example", display_name="Y"))
    await db_session.commit()
    await upsert_user_copyright_config(
        did=did,
        paradigm=settings.indiemusi.paradigm_id,
        config_uri=None,
        paradigm_data={"firstName": "x", "lastName": "y"},
    )
    await enable_flag(db_session, did, "copyright-paradigm")
    await db_session.commit()

    assert await _check_copyright_paradigm(did) is True


async def test_check_paradigm_false_when_only_flag_set(
    db_session: AsyncSession,
) -> None:
    """flag without an opt-in config → no scope re-request (no record to update)."""
    did = "did:test:flagged-but-not-opted-in"
    db_session.add(Artist(did=did, handle="z.example", display_name="Z"))
    await enable_flag(db_session, did, "copyright-paradigm")
    await db_session.commit()

    assert await _check_copyright_paradigm(did) is False

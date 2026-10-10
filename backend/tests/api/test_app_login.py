"""tests for native app sign-in: identity-only grant, PKCE-bound exchange."""

from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, create_session, get_session, require_auth
from backend._internal.auth.app_login import (
    get_pending_app_login,
    is_native_app_scope,
    refuse_write_outside_grant,
    save_pending_app_login,
)
from backend._internal.auth.exchange import pkce_challenge
from backend._internal.auth.oauth import (
    get_oauth_client_for_scope,
    start_native_app_oauth_flow,
)
from backend.api.meta import client_metadata
from backend.config import settings
from backend.main import app

VERIFIER = "v" * 64
CHALLENGE = pkce_challenge(VERIFIER)
DID = "did:plc:applogin"
HANDLE = "phone.example.com"
BROWSER_UA = "Mozilla/5.0 (iPhone) AppleWebKit Safari"


def _oauth_data(scope: str) -> dict[str, str]:
    return {
        "did": DID,
        "handle": HANDLE,
        "pds_url": "https://pds.example.com",
        "authserver_iss": "https://pds.example.com",
        "scope": scope,
        "access_token": "access",
        "refresh_token": "refresh",
        "dpop_private_key_pem": "pem",
    }


def _session(scope: str) -> Session:
    return Session(
        session_id="sid", did=DID, handle=HANDLE, oauth_session=_oauth_data(scope)
    )


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def test_pkce_challenge_matches_rfc_7636_example() -> None:
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert pkce_challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


async def test_native_app_scope_is_identity_only_and_published() -> None:
    assert settings.atproto.native_app_scope == "atproto"
    declared = set((await client_metadata())["scope"].split())
    assert set(settings.atproto.native_app_scope.split()) <= declared


def test_web_grants_are_not_native_app_scope() -> None:
    assert is_native_app_scope("atproto")
    assert not is_native_app_scope("")
    assert not is_native_app_scope(settings.atproto.resolved_scope)
    assert not is_native_app_scope("atproto repo:fm.plyr.like")


def test_callback_client_keeps_the_narrow_scope() -> None:
    assert get_oauth_client_for_scope("atproto").scope == "atproto"
    assert (
        get_oauth_client_for_scope(settings.atproto.resolved_scope).scope
        == settings.atproto.resolved_scope
    )


async def test_native_app_flow_requests_only_its_scope() -> None:
    with patch(
        "backend._internal.auth.oauth._start_authorization_with_retry",
        new_callable=AsyncMock,
        return_value=("https://pds.example.com/authorize", "state"),
    ) as start:
        await start_native_app_oauth_flow(HANDLE)

    assert start.await_args is not None
    assert start.await_args.args[0].scope == "atproto"


async def test_start_saves_the_challenge(db_session: AsyncSession) -> None:
    with patch(
        "backend.api.auth_app.start_native_app_oauth_flow",
        new_callable=AsyncMock,
        return_value=("https://pds.example.com/authorize", "state-start"),
    ):
        async with _client() as client:
            response = await client.post(
                "/auth/app/start",
                json={"handle": HANDLE, "code_challenge": CHALLENGE},
            )

    assert response.status_code == 200
    assert response.json() == {"auth_url": "https://pds.example.com/authorize"}
    assert await get_pending_app_login("state-start") == CHALLENGE


async def test_account_creation_uses_the_narrow_scope(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings.account_creation, "enabled", True)
    with patch(
        "backend.api.auth_app.start_oauth_flow_for_pds",
        new_callable=AsyncMock,
        return_value=("https://pds.example.com/authorize", "state-create"),
    ) as start:
        async with _client() as client:
            response = await client.post(
                "/auth/app/start",
                json={
                    "pds_url": "https://pds.example.com",
                    "code_challenge": CHALLENGE,
                },
            )

    assert response.status_code == 200
    start.assert_awaited_once_with("https://pds.example.com", scope="atproto")
    assert await get_pending_app_login("state-create") == CHALLENGE


@pytest.mark.parametrize(
    "body",
    [
        {"handle": HANDLE, "code_challenge": "too-short"},
        {"handle": HANDLE},
    ],
)
async def test_start_rejects_a_bad_challenge(
    db_session: AsyncSession, body: dict[str, str]
) -> None:
    async with _client() as client:
        response = await client.post("/auth/app/start", json=body)
    assert response.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"code_challenge": CHALLENGE},
        {
            "handle": HANDLE,
            "pds_url": "https://pds.example.com",
            "code_challenge": CHALLENGE,
        },
    ],
)
async def test_start_needs_exactly_one_target(
    db_session: AsyncSession, body: dict[str, str]
) -> None:
    async with _client() as client:
        response = await client.post("/auth/app/start", json=body)
    assert response.status_code == 400


async def test_start_names_an_unknown_handle(db_session: AsyncSession) -> None:
    with (
        patch(
            "backend.api.auth_app.start_native_app_oauth_flow",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=400, detail="failed to start"),
        ),
        patch(
            "backend.api.auth_app.resolve_handle",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        async with _client() as client:
            response = await client.post(
                "/auth/app/start",
                json={"handle": "nobody.example.com", "code_challenge": CHALLENGE},
            )

    assert response.status_code == 404
    assert response.json()["detail"] == "handle_not_found"


async def test_callback_returns_a_code_only_the_verifier_redeems(
    db_session: AsyncSession,
) -> None:
    await save_pending_app_login("state-ok", CHALLENGE)

    with (
        patch(
            "backend.api.auth.handle_oauth_callback",
            new_callable=AsyncMock,
            return_value=(DID, HANDLE, _oauth_data("atproto")),
        ),
        patch("backend.api.auth.ensure_artist_exists", new_callable=AsyncMock),
        patch("backend.api.auth.schedule_atproto_sync", new_callable=AsyncMock) as sync,
    ):
        async with _client() as client:
            callback = await client.get(
                "/auth/callback",
                params={"state": "state-ok", "code": "c", "iss": "https://pds"},
            )
            assert callback.status_code == 303
            location = urlparse(callback.headers["location"])
            assert f"{location.scheme}://{location.netloc}" == "fm.plyr://auth"
            code = parse_qs(location.query)["code"][0]

            headers = {"user-agent": BROWSER_UA}
            for body in (
                {"exchange_token": code},
                {"exchange_token": code, "code_verifier": "w" * 64},
            ):
                refused = await client.post(
                    "/auth/exchange", json=body, headers=headers
                )
                assert refused.status_code == 401

            redeemed = await client.post(
                "/auth/exchange",
                json={"exchange_token": code, "code_verifier": VERIFIER},
                headers=headers,
            )
            replayed = await client.post(
                "/auth/exchange",
                json={"exchange_token": code, "code_verifier": VERIFIER},
                headers=headers,
            )

    sync.assert_not_awaited()
    assert await get_pending_app_login("state-ok") is None
    assert redeemed.status_code == 200
    assert "set-cookie" not in redeemed.headers
    assert replayed.status_code == 401

    session = await require_auth(
        authorization=f"Bearer {redeemed.json()['session_id']}", session_id=None
    )
    assert session.did == DID
    assert session.oauth_session["scope"] == "atproto"


async def test_callback_sends_a_refusal_back_to_the_app(
    db_session: AsyncSession,
) -> None:
    await save_pending_app_login("state-denied", CHALLENGE)

    async with _client() as client:
        callback = await client.get(
            "/auth/callback",
            params={"state": "state-denied", "error": "access_denied"},
        )

    assert callback.status_code == 303
    assert callback.headers["location"] == "fm.plyr://auth?error=access_denied"
    assert await get_pending_app_login("state-denied") is None


async def test_web_callback_still_lands_on_the_frontend(
    db_session: AsyncSession,
) -> None:
    async with _client() as client:
        callback = await client.get(
            "/auth/callback", params={"state": "web", "error": "access_denied"}
        )

    assert callback.headers["location"].startswith(settings.frontend.url)


async def test_require_auth_accepts_an_identity_only_app_session(
    db_session: AsyncSession,
) -> None:
    app_session_id = await create_session(DID, HANDLE, _oauth_data("atproto"))
    narrow_web_session_id = await create_session(
        DID, HANDLE, _oauth_data("atproto repo:fm.plyr.like")
    )

    session = await require_auth(
        authorization=f"Bearer {app_session_id}", session_id=None
    )
    assert session.did == DID

    with pytest.raises(HTTPException) as refused:
        await require_auth(
            authorization=f"Bearer {narrow_web_session_id}", session_id=None
        )
    assert refused.value.detail == "scope_upgrade_required"


@pytest.mark.parametrize(
    ("endpoint", "payload"),
    [
        ("com.atproto.repo.createRecord", {"collection": "fm.plyr.like"}),
        ("com.atproto.repo.putRecord", {"collection": "fm.plyr.actor.profile"}),
        ("com.atproto.repo.deleteRecord", {"collection": "fm.plyr.like"}),
        (
            "com.atproto.repo.applyWrites",
            {
                "writes": [
                    {
                        "$type": "com.atproto.repo.applyWrites#create",
                        "collection": "fm.plyr.list",
                    }
                ]
            },
        ),
        ("com.atproto.repo.uploadBlob", None),
    ],
)
def test_identity_only_session_cannot_write(
    endpoint: str, payload: dict[str, object] | None
) -> None:
    with pytest.raises(HTTPException) as refused:
        refuse_write_outside_grant(_session("atproto"), endpoint, payload)

    assert refused.value.status_code == 403
    assert refused.value.detail == "scope_upgrade_required"


def test_reads_and_web_sessions_pass_the_write_guard() -> None:
    refuse_write_outside_grant(
        _session("atproto"),
        "com.atproto.repo.getRecord",
        {"collection": "fm.plyr.like"},
    )
    refuse_write_outside_grant(
        _session(settings.atproto.resolved_scope),
        "com.atproto.repo.createRecord",
        {"collection": "fm.plyr.like"},
    )


async def test_logout_revokes_the_grant_and_survives_an_unreachable_pds(
    db_session: AsyncSession,
) -> None:
    session_id = await create_session(DID, HANDLE, _oauth_data("atproto"))
    revoke = AsyncMock(side_effect=TimeoutError())

    with (
        patch(
            "backend._internal.atproto.client.reconstruct_oauth_session",
            new_callable=AsyncMock,
            return_value="oauth-session",
        ),
        patch("backend._internal.auth.revoke.get_oauth_client") as get_client,
    ):
        get_client.return_value.revoke_session = revoke
        async with _client() as client:
            response = await client.post(
                "/auth/logout", headers={"authorization": f"Bearer {session_id}"}
            )

    assert response.status_code == 200
    revoke.assert_awaited_once_with("oauth-session")
    assert await get_session(session_id) is None

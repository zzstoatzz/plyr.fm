"""app-password developer-token minting + the bearer PDS write path.

covers the browserless mint (`create_app_password_session`) and the app-password
branch of the atproto client (`make_pds_request` / `upload_blob` dispatch, bearer
requests, and `com.atproto.server.refreshSession` rotation) that stands in for
the OAuth/DPoP path when a session carries `auth_type: "app_password"`.
"""

import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import (
    SessionExpiredError,
    _refresh_app_password_session,
    make_pds_request,
    upload_blob,
)
from backend._internal.auth.app_password import (
    AppPasswordAuthError,
    create_app_password_session,
)
from backend.config import settings


def _response(status_code: int = 200, json_data: dict | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = "ok"
    return resp


def _fake_async_client(responses: list) -> tuple[MagicMock, MagicMock]:
    """build a patch target for httpx.AsyncClient.

    every `async with httpx.AsyncClient() as http` yields the same http mock;
    its request/post return `responses` in order (an httpx error in the list is
    raised). returns (client_factory, http) so tests can assert call counts.
    """
    http = MagicMock()
    http.request = AsyncMock(side_effect=list(responses))
    http.post = AsyncMock(side_effect=list(responses))
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=http)
    cm.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=cm), http


def _app_pw_session(
    access: str = "access-1", refresh: str = "refresh-1"
) -> AuthSession:
    return AuthSession(
        session_id="sess-1",
        did="did:plc:test",
        handle="tester.example",
        oauth_session={
            "auth_type": "app_password",
            "did": "did:plc:test",
            "handle": "tester.example",
            "pds_url": "https://pds.example",
            "access_token": access,
            "refresh_token": refresh,
        },
    )


@contextlib.asynccontextmanager
async def _noop_lock(session_id: str):
    yield


# --- minting -------------------------------------------------------------


async def test_mint_disabled_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", False)
    with pytest.raises(AppPasswordAuthError, match="disabled"):
        await create_app_password_session("h.example", "pw", "https://pds.example")


async def test_mint_builds_app_password_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    factory, _ = _fake_async_client(
        [
            _response(
                200,
                {
                    "did": "did:plc:test",
                    "handle": "tester.example",
                    "accessJwt": "acc",
                    "refreshJwt": "ref",
                },
            )
        ]
    )
    create_mock = AsyncMock(return_value="sess-xyz")
    with (
        patch("backend._internal.auth.app_password.httpx.AsyncClient", factory),
        patch("backend._internal.auth.app_password.create_session", create_mock),
    ):
        result = await create_app_password_session(
            "tester.example", "pw", "https://pds.example/", token_name="ci"
        )

    assert result == {
        "token": "sess-xyz",
        "did": "did:plc:test",
        "handle": "tester.example",
    }
    kwargs = create_mock.await_args.kwargs
    assert kwargs["is_developer_token"] is True
    assert kwargs["token_name"] == "ci"
    session = kwargs["oauth_session"]
    assert session["auth_type"] == "app_password"
    assert session["access_token"] == "acc"
    assert session["refresh_token"] == "ref"
    assert session["pds_url"] == "https://pds.example"  # trailing slash stripped
    assert "refresh_token_expires_at" in session


async def test_mint_bad_credentials_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    factory, _ = _fake_async_client([_response(401, {})])
    with (
        patch("backend._internal.auth.app_password.httpx.AsyncClient", factory),
        pytest.raises(AppPasswordAuthError, match="createSession failed"),
    ):
        await create_app_password_session("h.example", "bad", "https://pds.example")


# --- bearer request path -------------------------------------------------


async def test_make_pds_request_dispatches_to_bearer_path() -> None:
    """an app_password session must never touch the OAuth/DPoP reconstruction."""
    factory, http = _fake_async_client([_response(200, {"uri": "at://x"})])
    with patch("backend._internal.atproto.client.httpx.AsyncClient", factory):
        result = await make_pds_request(
            _app_pw_session(), "POST", "com.atproto.repo.createRecord", payload={"a": 1}
        )
    assert result == {"uri": "at://x"}
    # bearer auth, not DPoP
    assert (
        http.request.await_args.kwargs["headers"]["Authorization"] == "Bearer access-1"
    )


async def test_bearer_request_refreshes_on_401_then_succeeds() -> None:
    factory, _ = _fake_async_client([_response(401, {}), _response(200, {"ok": 1})])
    refresh = AsyncMock(return_value="access-2")
    with (
        patch("backend._internal.atproto.client.httpx.AsyncClient", factory),
        patch(
            "backend._internal.atproto.client._refresh_app_password_session", refresh
        ),
    ):
        result = await make_pds_request(
            _app_pw_session(), "POST", "com.atproto.repo.createRecord", payload={}
        )
    assert result == {"ok": 1}
    refresh.assert_awaited_once()


async def test_upload_blob_dispatches_to_bearer_path() -> None:
    factory, http = _fake_async_client(
        [_response(200, {"blob": {"ref": {"$link": "bafyblob"}}})]
    )
    with patch("backend._internal.atproto.client.httpx.AsyncClient", factory):
        blob = await upload_blob(
            _app_pw_session(), data=b"RIFFwav", content_type="audio/wav"
        )
    assert blob == {"ref": {"$link": "bafyblob"}}
    assert http.post.await_args.kwargs["headers"]["Authorization"] == "Bearer access-1"


# --- refresh -------------------------------------------------------------


async def test_refresh_rotates_and_persists() -> None:
    factory, _ = _fake_async_client(
        [_response(200, {"accessJwt": "acc-new", "refreshJwt": "ref-new"})]
    )
    update = AsyncMock()
    reloaded = _app_pw_session()  # same access token → forces a real refresh
    with (
        patch("backend._internal.atproto.client._session_refresh_lock", _noop_lock),
        patch(
            "backend._internal.atproto.client.get_session",
            AsyncMock(return_value=reloaded),
        ),
        patch("backend._internal.atproto.client.update_session_tokens", update),
        patch("backend._internal.atproto.client.httpx.AsyncClient", factory),
    ):
        new_access = await _refresh_app_password_session(_app_pw_session(), "access-1")

    assert new_access == "acc-new"
    persisted = update.await_args.args[1]
    assert persisted["access_token"] == "acc-new"
    assert persisted["refresh_token"] == "ref-new"
    assert persisted["auth_type"] == "app_password"


async def test_refresh_dead_token_raises_session_expired() -> None:
    factory, _ = _fake_async_client([_response(400, {"error": "ExpiredToken"})])
    with (
        patch("backend._internal.atproto.client._session_refresh_lock", _noop_lock),
        patch(
            "backend._internal.atproto.client.get_session",
            AsyncMock(return_value=_app_pw_session()),
        ),
        patch("backend._internal.atproto.client.httpx.AsyncClient", factory),
        pytest.raises(SessionExpiredError),
    ):
        await _refresh_app_password_session(_app_pw_session(), "access-1")

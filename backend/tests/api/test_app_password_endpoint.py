"""POST /auth/dev-token/app-password — gated JIT dev-token minting for CI.

the endpoint is doubly gated (AUTH_ALLOW_APP_PASSWORD_DEV_TOKENS + a shared
admin secret) and unauthenticated by session — the app-password in the body is
the account authorization, the admin secret keeps it from being a public oracle.
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from backend.config import settings
from backend.main import app

URL = "/auth/dev-token/app-password"
BODY = {"identifier": "tester.example", "app_password": "pw-xxxx"}


async def _post(headers: dict | None = None) -> tuple[int, dict]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(URL, json=BODY, headers=headers or {})
    return r.status_code, (r.json() if r.content else {})


async def test_disabled_when_flag_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", False)
    monkeypatch.setattr(settings.auth, "app_password_mint_secret", "shh")
    status, _ = await _post({"x-admin-token": "shh"})
    assert status == 404


async def test_disabled_when_secret_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    monkeypatch.setattr(settings.auth, "app_password_mint_secret", "")
    status, _ = await _post({"x-admin-token": "anything"})
    assert status == 404


async def test_missing_admin_token_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    monkeypatch.setattr(settings.auth, "app_password_mint_secret", "shh")
    status, _ = await _post()
    assert status == 403


async def test_wrong_admin_token_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    monkeypatch.setattr(settings.auth, "app_password_mint_secret", "shh")
    status, _ = await _post({"x-admin-token": "wrong"})
    assert status == 403


async def test_success_mints_short_lived_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    monkeypatch.setattr(settings.auth, "app_password_mint_secret", "shh")
    mint = AsyncMock(
        return_value={"token": "tok-1", "did": "did:plc:x", "handle": "tester.example"}
    )
    with (
        patch(
            "backend.api.auth.resolve_pds",
            AsyncMock(return_value="https://pds.example"),
        ),
        patch("backend.api.auth.create_app_password_session", mint),
    ):
        status, body = await _post({"x-admin-token": "shh"})

    assert status == 200
    assert body == {"token": "tok-1", "did": "did:plc:x", "handle": "tester.example"}
    # JIT tokens are short-lived so an un-revoked one still GCs quickly
    assert mint.await_args.kwargs["expires_in_days"] == 1


async def test_bad_app_password_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend._internal.auth.app_password import AppPasswordAuthError

    monkeypatch.setattr(settings.auth, "allow_app_password_dev_tokens", True)
    monkeypatch.setattr(settings.auth, "app_password_mint_secret", "shh")
    with (
        patch(
            "backend.api.auth.resolve_pds",
            AsyncMock(return_value="https://pds.example"),
        ),
        patch(
            "backend.api.auth.create_app_password_session",
            AsyncMock(side_effect=AppPasswordAuthError("createSession failed: 401")),
        ),
    ):
        status, body = await _post({"x-admin-token": "shh"})

    assert status == 400
    assert "createSession failed" in body["detail"]

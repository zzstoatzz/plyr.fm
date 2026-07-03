"""require_auth must not apply the OAuth scope-coverage gate to app-password
sessions — they hold full repo access, not an OAuth grant, so scope_upgrade
does not apply. regression for JIT dev tokens 403ing on scope-gated endpoints.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend._internal import Session as AuthSession
from backend._internal.auth.dependencies import require_auth


def _session(oauth: dict) -> AuthSession:
    return AuthSession(
        session_id="s", did="did:plc:x", handle="tester.example", oauth_session=oauth
    )


async def test_app_password_session_bypasses_scope_gate() -> None:
    sess = _session(
        {"auth_type": "app_password", "access_token": "a", "pds_url": "https://p"}
    )
    with (
        patch(
            "backend._internal.auth.dependencies.get_session",
            AsyncMock(return_value=sess),
        ),
        # even if the scope check would fail, the app-password session bypasses it
        patch(
            "backend._internal.auth.dependencies.check_scope_coverage",
            return_value=False,
        ),
    ):
        result = await require_auth(authorization="Bearer tok")
    assert result is sess


async def test_oauth_session_still_scope_gated() -> None:
    sess = _session({"access_token": "a", "scope": "atproto"})  # no auth_type
    with (
        patch(
            "backend._internal.auth.dependencies.get_session",
            AsyncMock(return_value=sess),
        ),
        patch(
            "backend._internal.auth.dependencies.check_scope_coverage",
            return_value=False,
        ),
        pytest.raises(HTTPException) as exc,
    ):
        await require_auth(authorization="Bearer tok")
    assert exc.value.status_code == 403
    assert exc.value.detail == "scope_upgrade_required"

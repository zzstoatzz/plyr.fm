"""login requests the private-media space scope, with a fallback (#1528).

capability can't be probed before the scope is granted, so OAuth itself is the
discovery: request `include:<privateMedia>` at login; if the PDS can't resolve
the permission set it rejects PAR with `invalid_scope`, and we retry without it.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend._internal.auth import oauth


class _FakeClient:
    """stand-in OAuth client whose start_authorization is scripted per attempt."""

    def __init__(self, *, raise_invalid_scope: bool) -> None:
        self._raise = raise_invalid_scope

    async def start_authorization(self, handle: str, prompt=None):
        if self._raise:
            raise Exception("invalid_scope: Failed to resolve requested permission set")
        return ("https://pds.test/authorize?x=1", "state-token")


@pytest.fixture(autouse=True)
def _stub_prefs():
    # isolate start_oauth_flow from handle resolution + preference lookups.
    # resolve_handle is imported lazily inside the function, so patch it at source.
    with (
        patch(
            "backend._internal.atproto.handles.resolve_handle",
            AsyncMock(return_value={"did": "did:plc:x"}),
        ),
        patch.object(oauth, "_check_teal_preference", AsyncMock(return_value=False)),
        patch.object(oauth, "_check_copyright_paradigm", AsyncMock(return_value=False)),
    ):
        yield


async def test_login_requests_permissioned_scope_first():
    calls: list[bool] = []

    def fake_get_client(*, include_permissioned=False, **kwargs):
        calls.append(include_permissioned)
        return _FakeClient(raise_invalid_scope=False)

    with patch.object(oauth, "get_oauth_client", fake_get_client):
        auth_url, state = await oauth.start_oauth_flow("user.test")

    assert auth_url.startswith("https://pds.test/authorize")
    assert state == "state-token"
    # the FIRST (and only) attempt asked for the private-media scope
    assert calls == [True]


async def test_login_falls_back_when_pds_rejects_scope():
    calls: list[bool] = []

    def fake_get_client(*, include_permissioned=False, **kwargs):
        calls.append(include_permissioned)
        # a PDS that can't grant the permission set rejects the scoped attempt
        return _FakeClient(raise_invalid_scope=include_permissioned)

    with patch.object(oauth, "get_oauth_client", fake_get_client):
        auth_url, state = await oauth.start_oauth_flow("user.test")

    # tried with the scope, then retried without it — login still succeeds
    assert calls == [True, False]
    assert auth_url.startswith("https://pds.test/authorize")
    assert state == "state-token"


async def test_login_does_not_swallow_unrelated_errors():
    def fake_get_client(*, include_permissioned=False, **kwargs):
        return _FakeClient(raise_invalid_scope=False)

    async def _boom(handle, prompt=None):
        raise Exception("network exploded")

    # a non-invalid_scope failure is a real error, surfaced (not retried into a
    # fallback that hides it)
    with (
        patch.object(oauth, "get_oauth_client", fake_get_client),
        patch.object(_FakeClient, "start_authorization", _boom),
        pytest.raises(Exception, match="failed to start OAuth flow"),
    ):
        await oauth.start_oauth_flow("user.test")

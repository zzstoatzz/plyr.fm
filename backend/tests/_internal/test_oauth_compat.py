"""OAuth provider interoperability regressions."""

from types import SimpleNamespace

import httpx
import pytest
from atproto_oauth import OAuthClient, OAuthState
from atproto_oauth import client as oauth_client_module
from atproto_oauth.client import _scopes_are_equivalent
from atproto_oauth.exceptions import OAuthTokenError
from atproto_oauth.stores.memory import MemorySessionStore, MemoryStateStore
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal.auth.oauth import get_oauth_client
from backend._internal.auth.oauth_compat import (
    BlackskyCompatibleOAuthClient,
    normalize_token_scope,
)

_REQUESTED_SCOPE = (
    "atproto blob:*/* include:fm.plyr.authFullApp include:fm.plyr.privateMediaAccess"
)
_BLACKSKY_SCOPE = (
    "atproto blob:*/* "
    "repo:?collection=fm.plyr.track&collection=fm.plyr.like&"
    "collection=fm.plyr.comment&collection=fm.plyr.list&"
    "collection=fm.plyr.actor.profile&action=create&action=update&action=delete "
    "space:fm.plyr.privateMedia?authority=self&skey=self&"
    "collection=fm.plyr.track&action=read&action=create&action=update&"
    "action=delete&manage=create&manage=update&manage=delete "
    "space:fm.plyr.privateMedia?authority=*&skey=self&"
    "collection=fm.plyr.track&action=read"
)


async def _callback_client(
    client_type: type[OAuthClient], monkeypatch: pytest.MonkeyPatch
) -> OAuthClient:
    state_store = MemoryStateStore()
    client = client_type(
        client_id="https://plyr.test/oauth-client-metadata.json",
        redirect_uri="https://plyr.test/oauth/callback",
        scope=_REQUESTED_SCOPE,
        state_store=state_store,
        session_store=MemorySessionStore(),
    )
    oauth_state = OAuthState(
        state="state",
        pkce_verifier="verifier",
        redirect_uri="https://plyr.test/oauth/callback",
        scope=_REQUESTED_SCOPE,
        authserver_iss="https://blacksky.app",
        dpop_private_key=ec.generate_private_key(ec.SECP256R1()),
        dpop_authserver_nonce="",
        did="did:plc:test",
        handle="test.blacksky.app",
        pds_url="https://pds.test",
    )
    await state_store.save_state(oauth_state)

    async def fetch_metadata(_: str) -> SimpleNamespace:
        return SimpleNamespace(
            issuer="https://blacksky.app",
            token_endpoint="https://blacksky.app/oauth/token",
        )

    async def make_token_request(**_: object) -> tuple[str, httpx.Response]:
        return "nonce", httpx.Response(
            200,
            json={
                "access_token": "access",
                "token_type": "DPoP",
                "scope": _BLACKSKY_SCOPE,
                "sub": "did:plc:test",
                "refresh_token": "refresh",
                "expires_in": 3600,
            },
        )

    async def resolve_atproto_data(
        _: str, *, force_refresh: bool = False
    ) -> SimpleNamespace:
        assert force_refresh
        return SimpleNamespace(pds="https://pds.test")

    async def discover_authserver(_: str) -> str:
        return "https://blacksky.app"

    monkeypatch.setattr(
        oauth_client_module, "fetch_authserver_metadata_async", fetch_metadata
    )
    monkeypatch.setattr(
        oauth_client_module, "discover_authserver_from_pds_async", discover_authserver
    )
    monkeypatch.setattr(client, "_make_token_request", make_token_request)
    monkeypatch.setattr(
        client._id_resolver.did, "resolve_atproto_data", resolve_atproto_data
    )
    return client


def test_blacksky_scope_normalization_restores_semantic_validation() -> None:
    assert not _scopes_are_equivalent(_REQUESTED_SCOPE, _BLACKSKY_SCOPE)

    normalized = normalize_token_scope("https://blacksky.app", _BLACKSKY_SCOPE)

    assert "repo:?" not in normalized
    assert _scopes_are_equivalent(_REQUESTED_SCOPE, normalized)


async def test_blacksky_callback_accepts_noncanonical_repo_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream_client = await _callback_client(OAuthClient, monkeypatch)
    with pytest.raises(OAuthTokenError, match="Scope mismatch"):
        await upstream_client.handle_callback(
            code="code", state="state", iss="https://blacksky.app"
        )

    compatible_client = await _callback_client(
        BlackskyCompatibleOAuthClient, monkeypatch
    )
    session = await compatible_client.handle_callback(
        code="code", state="state", iss="https://blacksky.app"
    )

    assert session.did == "did:plc:test"
    assert "repo:?" not in session.scope


def test_scope_normalization_is_limited_to_blacksky() -> None:
    assert (
        normalize_token_scope("https://other.example", _BLACKSKY_SCOPE)
        == _BLACKSKY_SCOPE
    )


def test_oauth_client_uses_blacksky_compatibility() -> None:
    assert isinstance(get_oauth_client(), BlackskyCompatibleOAuthClient)

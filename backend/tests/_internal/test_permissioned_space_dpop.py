"""DPoP binding and rollout behavior for permissioned-space credentials."""

import base64
import hashlib
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from jose import jwt

from backend._internal import Session
from backend._internal.atproto.spaces import client as space_client


@pytest.mark.parametrize(
    ("issuance", "scheme", "has_ath"),
    [(True, "Bearer", False), (False, "DPoP", True)],
)
def test_space_dpop_headers_bind_the_correct_operation(
    issuance: bool, scheme: str, has_ath: bool
) -> None:
    token = "permissioned-token"
    headers = space_client._space_dpop_headers(
        "GET",
        "https://space.test/xrpc/com.atproto.space.listRecords?space=ignored",
        token,
        space_client.DPoPManager.generate_keypair(),
        issuance=issuance,
    )

    claims = jwt.get_unverified_claims(headers["dpop"])
    assert headers["authorization"] == f"{scheme} {token}"
    assert jwt.get_unverified_header(headers["dpop"])["typ"] == "dpop+jwt"
    assert claims["htm"] == "GET"
    assert claims["htu"] == "https://space.test/xrpc/com.atproto.space.listRecords"
    assert ("ath" in claims) is has_ath
    if has_ath:
        expected_ath = (
            base64.urlsafe_b64encode(hashlib.sha256(token.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        assert claims["ath"] == expected_ath


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (401, {"error": "AuthenticationRequired"}, True),
        (401, {"error": "InvalidDpopProof"}, False),
        (403, {"error": "AuthenticationRequired"}, False),
    ],
)
def test_pre_dpop_rejection_is_narrow(
    status: int, body: dict[str, str], expected: bool
) -> None:
    response = httpx.Response(status, json=body)
    assert space_client._is_pre_dpop_rejection(response) is expected


async def test_credential_read_bridges_only_a_pre_dpop_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credential = space_client.SpaceCredential(
        token="space-credential",
        dpop_key=space_client.DPoPManager.generate_keypair(),
        expires_at=time.monotonic() + 300,
    )
    token_request = AsyncMock(
        side_effect=[
            httpx.Response(401, json={"error": "AuthenticationRequired"}),
            httpx.Response(200, json={"records": []}),
        ]
    )
    monkeypatch.setattr(
        space_client, "get_space_credential", AsyncMock(return_value=credential)
    )
    monkeypatch.setattr(space_client, "_space_token_request", token_request)
    session = Session(
        session_id="s",
        did="did:plc:user",
        handle="user.test",
        oauth_session={},
    )

    result = await space_client._credential_read(
        session,
        host_url="https://repo.test",
        endpoint="com.atproto.space.listRecords",
        space="at://did:plc:authority/space/fm.example.catalog/main",
        params={"repo": "did:plc:user"},
    )

    assert result == {"records": []}
    assert token_request.await_args_list[0].kwargs.get("legacy_bearer") is None
    assert token_request.await_args_list[1].kwargs["legacy_bearer"] is True


async def test_space_credential_cache_and_force_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space_client._credential_cache.clear()
    calls = {"n": 0}

    async def fake_mint(auth_session, space):
        calls["n"] += 1
        return space_client.SpaceCredential(
            token=f"cred-{calls['n']}",
            dpop_key=space_client.DPoPManager.generate_keypair(),
            expires_at=time.monotonic() + 300,
        )

    monkeypatch.setattr(space_client, "_mint_credential", fake_mint)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x"},
    )
    space = "at://did:plc:x/space/fm.plyr.privateMedia/self"

    first = await space_client.get_space_credential(session, space)
    cached = await space_client.get_space_credential(session, space)
    assert first is cached
    assert first.token == "cred-1"
    assert calls["n"] == 1

    renewed = await space_client.get_space_credential(
        session, space, force_refresh=True
    )
    assert renewed.token == "cred-2"
    assert calls["n"] == 2

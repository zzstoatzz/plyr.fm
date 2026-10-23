"""HTTP message signatures and renewal for permissioned-space credentials.

the header shapes are the ones ``@atproto/space`` verifies
(``packages/space/src/http-signature.ts`` on the permissioned-data branch).
"""

import base64
import json
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from atproto_crypto.did import parse_did_key
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from backend._internal import Session
from backend._internal.atproto.spaces import client as space_client


def _verify(
    headers: dict[str, str], key: ec.EllipticCurvePrivateKey, base: str
) -> None:
    label, _, encoded = headers["signature"].partition("=")
    assert label == "atproto-space-credential"
    assert encoded.startswith(":") and encoded.endswith(":")
    raw = base64.b64decode(encoded[1:-1])
    assert len(raw) == 64
    r, s = int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    key.public_key().verify(
        encode_dss_signature(r, s), base.encode(), ec.ECDSA(hashes.SHA256())
    )


async def test_credential_request_is_unsigned_and_binds_the_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = "at://did:plc:authority/space/fm.plyr.privateMedia/self"
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"credential": "a.b.c"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        space_client.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    monkeypatch.setattr(
        space_client,
        "make_pds_request",
        AsyncMock(return_value={"token": "delegation-token"}),
    )
    monkeypatch.setattr(
        space_client, "_space_host_url", AsyncMock(return_value="https://host.test")
    )
    monkeypatch.setattr(
        space_client, "create_space_client_attestation", lambda audience: None
    )
    session = Session(
        session_id="s", did="did:plc:user", handle="user.test", oauth_session={}
    )

    credential = await space_client._mint_credential(session, space)

    [request] = seen
    assert (
        str(request.url)
        == "https://host.test/xrpc/com.atproto.space.getSpaceCredential"
    )
    assert "authorization" not in request.headers
    assert "signature" not in request.headers
    body = json.loads(request.content)
    assert body == {
        "space": space,
        "credentialKid": space_client._did_key(credential.key),
        "delegationToken": "delegation-token",
    }
    assert parse_did_key(body["credentialKid"]).jwt_alg == "ES256"
    assert credential.token == "a.b.c"


def test_credential_use_signs_the_credential_and_its_audience() -> None:
    key = ec.generate_private_key(ec.SECP256R1())

    headers = space_client._space_signature_headers(
        "space-credential", key, audience="did:plc:writer"
    )

    signature_input = (
        '("authorization" "atproto-space-audience");tag="atproto-space-credential"'
    )
    assert headers["authorization"] == "Atproto-Space-Credential space-credential"
    assert headers["atproto-space-audience"] == "did:plc:writer"
    assert headers["signature-input"] == f"atproto-space-credential={signature_input}"
    assert "dpop" not in headers
    _verify(
        headers,
        key,
        '"authorization": Atproto-Space-Credential space-credential\n'
        '"atproto-space-audience": did:plc:writer\n'
        f'"@signature-params": {signature_input}',
    )


async def test_credential_read_renews_on_401_and_signs_for_the_host_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token_request = AsyncMock(
        side_effect=[
            httpx.Response(401, json={"error": "AuthenticationRequired"}),
            httpx.Response(200, json={"records": []}),
        ]
    )
    credential = space_client.SpaceCredential(
        token="space-credential",
        key=ec.generate_private_key(ec.SECP256R1()),
        expires_at=time.monotonic() + 300,
    )
    mint = AsyncMock(return_value=credential)
    monkeypatch.setattr(space_client, "get_space_credential", mint)
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
        audience="did:plc:user",
        endpoint="com.atproto.space.listRecords",
        space="at://did:plc:authority/space/fm.example.catalog/main",
        params={"repo": "did:plc:user"},
    )

    assert result == {"records": []}
    assert [c.kwargs["force_refresh"] for c in mint.await_args_list] == [False, True]
    assert all(
        c.kwargs["audience"] == "did:plc:user" for c in token_request.await_args_list
    )


async def test_space_credential_cache_and_force_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space_client._credential_cache.clear()
    calls = {"n": 0}

    async def fake_mint(auth_session, space):
        calls["n"] += 1
        return space_client.SpaceCredential(
            token=f"cred-{calls['n']}",
            key=ec.generate_private_key(ec.SECP256R1()),
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

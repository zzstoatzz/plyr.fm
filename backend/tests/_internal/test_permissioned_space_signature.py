"""HTTP message signatures and renewal for permissioned-space credentials.

the header shapes are the ones ``@atproto/space`` verifies
(``packages/space/src/http-signature.ts`` on the permissioned-data branch).
"""

import base64
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
    assert label == "atproto-space"
    assert encoded.startswith(":") and encoded.endswith(":")
    raw = base64.b64decode(encoded[1:-1])
    assert len(raw) == 64
    r, s = int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")
    key.public_key().verify(
        encode_dss_signature(r, s), base.encode(), ec.ECDSA(hashes.SHA256())
    )


def test_issuance_signs_the_delegation_token_and_names_the_key() -> None:
    key = ec.generate_private_key(ec.SECP256R1())

    headers = space_client._space_signature_headers("delegation-token", key)

    did_key = space_client._did_key(key)
    assert parse_did_key(did_key).jwt_alg == "ES256"
    signature_input = f'("authorization");keyid="{did_key}"'
    assert headers["authorization"] == "Bearer delegation-token"
    assert headers["signature-input"] == f"atproto-space={signature_input}"
    assert "atproto-space-audience" not in headers
    _verify(
        headers,
        key,
        '"authorization": Bearer delegation-token\n'
        f'"@signature-params": {signature_input}',
    )


def test_credential_use_signs_the_credential_and_its_audience() -> None:
    key = ec.generate_private_key(ec.SECP256R1())

    headers = space_client._space_signature_headers(
        "space-credential", key, audience="did:plc:writer"
    )

    signature_input = '("authorization" "atproto-space-audience")'
    assert headers["authorization"] == "Atproto-Space space-credential"
    assert headers["atproto-space-audience"] == "did:plc:writer"
    assert headers["signature-input"] == f"atproto-space={signature_input}"
    assert "dpop" not in headers
    _verify(
        headers,
        key,
        '"authorization": Atproto-Space space-credential\n'
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

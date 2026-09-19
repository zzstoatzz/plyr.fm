"""regression: plyr must reuse the DPoP nonce a PDS handed back.

2026-09-18: sessions were rebuilt from the database on every request with the
nonce from sign-in, so every PDS write 401ed first. PDSes that reject a stale
nonce before reading the body (selfhosted.social, blacksky.app) closed the
connection on streamed audio uploads; the client saw ReadError, never read the
fresh nonce, and every retry failed the same way.
"""

from __future__ import annotations

import base64
import json
import uuid
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from atproto_oauth.dpop import DPoPManager
from atproto_oauth.models import OAuthSession
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal import Session
from backend._internal.atproto import client as c
from backend.utilities.pds_nonce import (
    PdsNonceSessionStore,
    get_pds_nonce,
    set_pds_nonce,
)


@pytest.fixture
def pds_url() -> str:
    return f"https://{uuid.uuid4().hex[:10]}.pds.test"


def _key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def _oauth_data(pds_url: str, key: ec.EllipticCurvePrivateKey) -> dict:
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return {
        "did": "did:plc:nonce",
        "handle": "nonce.test",
        "pds_url": pds_url,
        "authserver_iss": pds_url,
        "access_token": "tok",
        "refresh_token": "ref",
        "dpop_private_key_pem": pem,
        "dpop_authserver_nonce": "",
        "dpop_pds_nonce": "from-sign-in",
        "scope": "atproto",
    }


async def test_reconstruct_prefers_the_nonce_the_pds_issued_last(
    pds_url: str,
) -> None:
    data = _oauth_data(pds_url, _key())
    assert (await c.reconstruct_oauth_session(data)).dpop_pds_nonce == "from-sign-in"

    await set_pds_nonce(pds_url, "issued-later")
    assert (await c.reconstruct_oauth_session(data)).dpop_pds_nonce == "issued-later"


async def test_session_store_forwards_the_nonce_for_every_process(
    pds_url: str,
) -> None:
    session = OAuthSession(
        did="did:plc:nonce",
        handle="nonce.test",
        pds_url=pds_url,
        authserver_iss=pds_url,
        access_token="tok",
        refresh_token="ref",
        dpop_private_key=_key(),
        dpop_authserver_nonce="",
        dpop_pds_nonce="learned-on-retry",
        scope="atproto",
    )
    await PdsNonceSessionStore().save_session(session)
    assert await get_pds_nonce(pds_url) == "learned-on-retry"


async def test_streamed_upload_primes_the_nonce_before_sending_the_body(
    pds_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """the PDS answers the bodyless probe with a nonce; the upload must carry
    that nonce on its first and only attempt."""
    session = await c.reconstruct_oauth_session(_oauth_data(pds_url, _key()))
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        proof_nonce = request.headers["DPoP"]
        seen.append((request.method, request.url.path))
        if request.url.path.endswith("getSession"):
            return httpx.Response(
                200, json={"did": "did:plc:nonce"}, headers={"DPoP-Nonce": "fresh"}
            )
        assert "fresh" in _proof_payload(proof_nonce)
        return httpx.Response(200, json={"blob": {"size": 3}})

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_with_mock(**kwargs: Any) -> httpx.AsyncClient:
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(c.httpx, "AsyncClient", client_with_mock)
    monkeypatch.setattr(
        c,
        "get_oauth_client",
        lambda: SimpleNamespace(_dpop=_dpop(), session_store=None),
    )

    response = await c._signed_streaming_post(
        session,
        f"{pds_url}/xrpc/com.atproto.repo.uploadBlob",
        lambda: gen_bytes(),
        headers={"Content-Type": "audio/mpeg", "Content-Length": "3"},
    )

    assert response.status_code == 200
    assert seen == [
        ("GET", "/xrpc/com.atproto.server.getSession"),
        ("POST", "/xrpc/com.atproto.repo.uploadBlob"),
    ]
    assert await get_pds_nonce(pds_url) == "fresh"


async def gen_bytes():
    yield b"abc"


def _dpop() -> DPoPManager:
    return DPoPManager()


def _proof_payload(proof: str) -> str:
    payload = proof.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.dumps(json.loads(base64.urlsafe_b64decode(payload)))


async def test_buffered_request_remembers_the_nonce_from_a_200(
    pds_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """the cache must fill from ordinary successful responses, not only from
    a 401 retry — the worker's first write after sign-in was still 401ing."""
    auth = Session.__new__(Session)
    auth.did = "did:plc:nonce"
    auth.handle = "nonce.test"
    auth.session_id = "sess-nonce"
    auth.oauth_session = _oauth_data(pds_url, _key())

    async def fake_request(**kwargs: Any) -> httpx.Response:
        return httpx.Response(
            200, json={"uri": "at://x"}, headers={"DPoP-Nonce": "from-a-200"}
        )

    monkeypatch.setattr(
        c,
        "get_oauth_client",
        lambda: SimpleNamespace(make_authenticated_request=fake_request),
    )
    result = await c.make_pds_request(auth, "POST", "com.atproto.repo.putRecord")
    assert result == {"uri": "at://x"}
    assert await get_pds_nonce(pds_url) == "from-a-200"

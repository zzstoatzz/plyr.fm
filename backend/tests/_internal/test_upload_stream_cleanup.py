"""An interrupted upload closes its source before the next attempt."""

import asyncio
from collections.abc import AsyncGenerator
from types import SimpleNamespace

import httpx
import pytest
from atproto_oauth.models import OAuthSession
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal import Session
from backend._internal.atproto import client as c


@pytest.mark.parametrize("bearer", [False, True])
@pytest.mark.parametrize("heartbeat", [False, True])
@pytest.mark.parametrize("outcome", ["network", "early_response", "cancel"])
async def test_upload_closes_partial_source(
    monkeypatch: pytest.MonkeyPatch, bearer: bool, heartbeat: bool, outcome: str
) -> None:
    closed: list[bool] = []
    sources: list[AsyncGenerator[bytes, None]] = []

    async def source() -> AsyncGenerator[bytes, None]:
        try:
            yield b"first"
            yield b"second"
        finally:
            closed.append(True)

    def factory() -> AsyncGenerator[bytes, None]:
        stream = source()
        sources.append(stream)
        return stream

    async def beat() -> None:
        pass

    class Transport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            assert isinstance(request.stream, httpx.AsyncByteStream)
            async for _chunk in request.stream:
                if outcome == "network":
                    raise httpx.ReadError("connection interrupted")
                if outcome == "cancel":
                    raise asyncio.CancelledError
                return httpx.Response(413, json={"error": "too large"})
            raise AssertionError("Expected request data")

    http_client = httpx.AsyncClient
    monkeypatch.setattr(
        c.httpx, "AsyncClient", lambda **kw: http_client(transport=Transport(), **kw)
    )
    monkeypatch.setattr(c, "_PDS_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(c, "is_safe_url", lambda _url: True)
    oauth = OAuthSession(
        did="did:plc:test",
        handle="test.test",
        pds_url="https://pds.test",
        authserver_iss="https://auth.test",
        access_token="token",
        refresh_token="refresh",
        dpop_private_key=ec.generate_private_key(ec.SECP256R1()),
        scope="atproto",
        dpop_authserver_nonce="nonce",
    )
    monkeypatch.setattr(c, "reconstruct_oauth_session", lambda _data: oauth)
    monkeypatch.setattr(
        c,
        "get_oauth_client",
        lambda: SimpleNamespace(
            _dpop=SimpleNamespace(
                create_proof=lambda **kw: "proof",
                is_dpop_nonce_error=lambda _response: False,
            )
        ),
    )
    session = Session.__new__(Session)
    session.did = "did:plc:test"
    session.oauth_session = {
        "access_token": "token",
        "pds_url": "https://pds.test",
        "auth_type": "app_password" if bearer else "oauth",
    }
    try:
        with pytest.raises(
            asyncio.CancelledError if outcome == "cancel" else Exception
        ):
            await c.upload_blob(
                session,
                body_factory=factory,
                content_length=11,
                content_type="audio/wav",
                heartbeat=beat if heartbeat else None,
            )
        assert closed == [True]
    finally:
        for stream in sources:
            await stream.aclose()

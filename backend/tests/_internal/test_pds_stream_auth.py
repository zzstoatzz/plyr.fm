from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest
from aiohttp import web
from atproto_oauth.dpop import DPoPManager
from atproto_oauth.models import OAuthSession
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal.atproto import client as c


@pytest.mark.parametrize(
    ("error", "requires_refresh"),
    [
        ("invalid_token", True),
        ("InvalidToken", True),
        ("ExpiredToken", True),
        ("use_dpop_nonce", False),
        ("InsufficientScope", False),
    ],
)
async def test_probe_authentication_before_streaming(
    unused_tcp_port: int,
    monkeypatch: pytest.MonkeyPatch,
    error: str,
    requires_refresh: bool,
) -> None:
    bodies: list[bytes] = []
    probes: list[str] = []
    body_starts: list[bool] = []

    async def probe(request: web.Request) -> web.Response:
        token = request.headers["Authorization"]
        probes.append(token)
        if token == "DPoP expired":
            return web.json_response(
                {"error": error}, status=401, headers={"DPoP-Nonce": "fresh-nonce"}
            )
        return web.json_response({"did": "did:plc:test"})

    async def upload(request: web.Request) -> web.Response:
        bodies.append(await request.read())
        return web.json_response({"blob": {"size": 3}})

    async def body() -> AsyncIterator[bytes]:
        body_starts.append(True)
        yield b"abc"

    app = web.Application()
    app.router.add_get("/xrpc/com.atproto.server.getSession", probe)
    app.router.add_post("/xrpc/com.atproto.repo.uploadBlob", upload)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", unused_tcp_port).start()
    url = f"http://127.0.0.1:{unused_tcp_port}"
    session = OAuthSession(
        did="did:plc:test",
        handle="test.example",
        pds_url=url,
        authserver_iss=url,
        access_token="expired",
        refresh_token="refresh",
        dpop_private_key=ec.generate_private_key(ec.SECP256R1()),
        dpop_authserver_nonce="",
        dpop_pds_nonce="",
        scope="atproto",
    )
    monkeypatch.setattr(c, "is_safe_url", lambda value: value.startswith(url + "/"))
    monkeypatch.setattr(
        c, "get_oauth_client", lambda: SimpleNamespace(_dpop=DPoPManager())
    )
    try:
        rejected = await c._signed_streaming_post(
            session,
            url + "/xrpc/com.atproto.repo.uploadBlob",
            body,
            headers={"Content-Length": "3"},
        )
        if not requires_refresh:
            assert rejected.status_code == 200
            assert bodies == [b"abc"]
            assert session.dpop_pds_nonce == "fresh-nonce"
            return
        assert rejected.status_code == 401
        assert rejected.json()["error"] == error
        assert bodies == []
        assert body_starts == []
        session.access_token = "fresh"
        accepted = await c._signed_streaming_post(
            session,
            url + "/xrpc/com.atproto.repo.uploadBlob",
            body,
            headers={"Content-Length": "3"},
        )
        assert accepted.status_code == 200
        assert bodies == [b"abc"]
        assert probes == ["DPoP expired", "DPoP fresh"]
    finally:
        await runner.cleanup()

from collections.abc import AsyncIterator
from types import SimpleNamespace

import httpx
import pytest
from aiohttp import web
from atproto_oauth import OAuthClient
from atproto_oauth import client as oauth_client_module
from atproto_oauth.stores.memory import MemorySessionStore, MemoryStateStore
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto import client as pds_client
from backend._internal.auth.session import (
    Session,
    _session_cache_key,
    create_session,
    get_session,
    update_session_tokens,
)
from backend._internal.jobs import job_service
from backend.api.tracks.uploads import UploadPhaseError, _try_upload_to_pds
from backend.config import settings
from backend.models.job import JobType
from backend.utilities.redis import get_async_redis_client


@pytest.fixture
async def rejected_session(
    db_session: AsyncSession,
    unused_tcp_port: int,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[Session, dict[str, str], list[str]]]:
    url = f"http://127.0.0.1:{unused_tcp_port}"
    rejection = {"error": "invalid_grant"}
    requests: list[str] = []

    async def probe(request: web.Request) -> web.Response:
        requests.append("probe")
        return web.json_response({"error": "invalid_token"}, status=401)

    async def refresh(request: web.Request) -> web.Response:
        requests.append("refresh")
        return web.json_response(
            rejection, status=503 if rejection["error"] == "server_error" else 400
        )

    app = web.Application()
    app.router.add_get("/xrpc/com.atproto.server.getSession", probe)
    app.router.add_post("/oauth/token", refresh)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", unused_tcp_port).start()
    client = OAuthClient(
        client_id="https://plyr.test/oauth-client-metadata.json",
        redirect_uri="https://plyr.test/auth/callback",
        scope=settings.atproto.resolved_scope,
        state_store=MemoryStateStore(),
        session_store=MemorySessionStore(),
    )

    async def metadata(_: str) -> SimpleNamespace:
        return SimpleNamespace(issuer=url, token_endpoint=f"{url}/oauth/token")

    monkeypatch.setattr(
        oauth_client_module, "fetch_authserver_metadata_async", metadata
    )
    monkeypatch.setattr(
        oauth_client_module, "get_hardened_async_client", httpx.AsyncClient
    )
    monkeypatch.setattr(
        oauth_client_module, "is_safe_url", lambda value: value.startswith(url + "/")
    )
    monkeypatch.setattr(pds_client, "get_oauth_client", lambda: client)
    monkeypatch.setattr(
        pds_client, "is_safe_url", lambda value: value.startswith(url + "/")
    )
    key = ec.generate_private_key(ec.SECP256R1())
    data = {
        "did": "did:plc:terminalsession",
        "handle": "terminal.test",
        "pds_url": url,
        "authserver_iss": url,
        "scope": settings.atproto.resolved_scope,
        "access_token": "expired",
        "refresh_token": "rejected",
        "dpop_private_key_pem": key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
    }
    try:
        session_id = await create_session(data["did"], data["handle"], data)
        session = await get_session(session_id)
        assert session is not None
        yield session, rejection, requests
    finally:
        await runner.cleanup()


@pytest.mark.parametrize("entrypoint", ["refresh", "upload"])
async def test_terminal_grant_stops_uploads_and_rejects_followup_requests(
    rejected_session: tuple[Session, dict[str, str], list[str]],
    fastapi_app: FastAPI,
    entrypoint: str,
) -> None:
    session, _, requests = rejected_session
    sibling_id = await create_session(
        session.did, session.handle, session.oauth_session
    )
    redis = get_async_redis_client()
    assert await redis.get(_session_cache_key(session.session_id)) is not None

    if entrypoint == "refresh":
        oauth = await pds_client.reconstruct_oauth_session(session.oauth_session)
        with pytest.raises(pds_client.SessionExpiredError):
            await pds_client._refresh_session_tokens(session, oauth)
    else:
        job_id = await job_service.create_job(JobType.UPLOAD, session.did, "uploading")

        async def body() -> AsyncIterator[bytes]:
            pytest.fail("the expired grant must be rejected before streaming")
            yield b"audio"

        with pytest.raises(UploadPhaseError, match="sign in again"):
            await _try_upload_to_pds(job_id, session, body, 5, "audio/mpeg")
        assert requests == ["probe", "refresh"]

    assert await get_session(session.session_id) is None
    assert await redis.get(_session_cache_key(session.session_id)) is None
    assert await get_session(sibling_id) is not None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/tracks/uploads",
            headers={"Authorization": f"Bearer {session.session_id}"},
            json={"filename": "song.mp3", "size_bytes": 5},
        )
    assert response.status_code == 401


@pytest.mark.parametrize("error", ["temporarily_unavailable", "server_error"])
async def test_transient_refresh_failure_keeps_session(
    rejected_session: tuple[Session, dict[str, str], list[str]],
    error: str,
) -> None:
    session, rejection, _ = rejected_session
    rejection["error"] = error
    rejection["error_description"] = "retry instead of treating this as invalid_grant"
    oauth = await pds_client.reconstruct_oauth_session(session.oauth_session)
    with pytest.raises(ValueError, match=error):
        await pds_client._refresh_session_tokens(session, oauth)
    assert await get_session(session.session_id) is not None


async def test_fresh_tokens_preserve_session_without_refreshing(
    rejected_session: tuple[Session, dict[str, str], list[str]],
) -> None:
    session, _, requests = rejected_session
    oauth = await pds_client.reconstruct_oauth_session(session.oauth_session)
    await update_session_tokens(
        session.session_id, {**session.oauth_session, "access_token": "fresh"}
    )
    refreshed = await pds_client._refresh_session_tokens(session, oauth)
    assert refreshed.access_token == "fresh"
    assert await get_session(session.session_id) is not None
    assert requests == []

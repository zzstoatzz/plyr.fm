"""Exercise app-only credential issuance over a real HTTP connection."""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from cachetools import TTLCache
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from jose import jwt

from backend._internal import Session
from backend._internal.atproto.spaces import capability, client
from backend._internal.auth import oauth
from backend._internal.auth.space_scope import private_media_grant_present
from backend.config import settings


@asynccontextmanager
async def credential_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[str, list[dict]]]:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    monkeypatch.setattr(oauth, "_client_secret_key_loaded", True)
    monkeypatch.setattr(oauth, "_client_secret_key", key)
    monkeypatch.setattr(oauth, "_client_secret_kid", "test-key")
    monkeypatch.setattr(client, "_credential_cache", {})
    requests: list[dict] = []

    async def respond(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            header = await reader.readuntil(b"\r\n\r\n")
            size = next(
                int(line.split(b":", 1)[1])
                for line in header.split(b"\r\n")
                if line.lower().startswith(b"content-length:")
            )
            payload = json.loads(await reader.readexactly(size))
            requests.append(payload)
            assert "delegationToken" not in payload
            claims = jwt.decode(
                payload["clientAttestation"],
                public,
                algorithms=["ES256"],
                audience="did:plc:artist#atproto_pds",
            )
            assert claims["iss"] == settings.atproto.client_id
            token = jwt.encode(
                {
                    "exp": int(time.time()) + 600,
                    "cnf": {"kid": payload["credentialKid"]},
                },
                pem,
                algorithm="ES256",
            )
            body = json.dumps({"credential": token}).encode()
            writer.write(
                f"HTTP/1.1 200 OK\r\nContent-Length: {len(body)}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    async with await asyncio.start_server(respond, "127.0.0.1", 0) as server:
        url = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"

        async def host(_space: str) -> str:
            return url

        monkeypatch.setattr(client, "_space_host_url", host)
        monkeypatch.setattr(
            client, "is_safe_url", lambda target: target.startswith(url + "/")
        )
        yield url, requests


async def test_app_credential_needs_no_listener_session_and_renews(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = f"at://did:plc:artist/space/{settings.atproto.private_media_space_type}/playback"
    async with credential_authority(monkeypatch) as (_, requests):
        first = await client.get_space_credential(None, space)
        cached = await client.get_space_credential(None, space)
        assert cached is first
        assert len(requests) == 1
        renewed = await client.get_space_credential(None, space, force_refresh=True)
        assert renewed.key is not first.key
        assert len(requests) == 2
        assert all(request["space"] == space for request in requests)


async def test_app_only_reads_refuse_public_client_before_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = f"at://did:plc:artist/space/{settings.atproto.private_media_space_type}/playback"
    async with credential_authority(monkeypatch) as (_, requests):
        monkeypatch.setattr(oauth, "_client_secret_key", None)
        monkeypatch.setattr(oauth, "_client_secret_kid", None)
        with pytest.raises(client.SpaceAccessError, match="confidential"):
            await client.get_space_credential(None, space)
        assert requests == []


def test_existing_private_grant_does_not_authorize_playback_space() -> None:
    scope = (
        f"space:{settings.atproto.private_media_space_type}?authority=did:plc:artist&skey=self"
        f"&collection={settings.atproto.track_collection}&action=create&manage=create"
    )
    assert private_media_grant_present(scope, "did:plc:artist")
    assert not private_media_grant_present(scope, "did:plc:artist", skey="playback")
    assert private_media_grant_present(
        scope.replace("skey=self", "skey=playback"), "did:plc:artist", skey="playback"
    )


@pytest.mark.parametrize("supported,status", [(True, 200), (False, 200), (False, 503)])
async def test_host_capability_probe_and_failure_are_distinct(
    monkeypatch: pytest.MonkeyPatch, supported: bool, status: int
) -> None:
    requests = 0

    async def describe(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        nonlocal requests
        try:
            header = await reader.readuntil(b"\r\n\r\n")
            assert header.startswith(b"GET /xrpc/com.atproto.server.describeServer ")
            requests += 1
            body = json.dumps({"spacesAlpha": supported}).encode()
            writer.write(
                f"HTTP/1.1 {status} Status\r\nContent-Length: {len(body)}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    async with await asyncio.start_server(describe, "127.0.0.1", 0) as server:
        url = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"
        session = Session(
            "session",
            "did:plc:artist",
            "artist.test",
            {"pds_url": url, "scope": "atproto"},
        )
        monkeypatch.setattr(capability, "_capabilities", TTLCache(maxsize=10, ttl=300))
        monkeypatch.setattr(
            capability, "is_safe_url", lambda candidate: candidate == url
        )
        if status == 503:
            with pytest.raises(HTTPException) as error:
                await capability.protected_storage_choice(session)
            assert error.value.status_code == 503
            assert url not in capability._capabilities
        else:
            assert await capability.pds_supports_spaces(session) is supported
            assert await capability.pds_supports_spaces(session) is supported
            assert requests == 1
            if supported:
                with pytest.raises(HTTPException) as error:
                    await capability.protected_storage_choice(session)
                assert error.value.status_code == 403
            else:
                assert await capability.protected_storage_choice(session) is False

"""Protected record responses bind authenticated CIDs to the returned values."""

import base64
import hashlib
import hmac
import struct
import time
from typing import Any
from unittest.mock import AsyncMock

import httpx
import libipld
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal.atproto.spaces import mac, protected_audio
from backend._internal.atproto.spaces.client import SpaceAccessError, SpaceCredential
from backend._internal.atproto.spaces.uris import build_record_uri, build_space_uri
from backend.config import settings


@pytest.mark.parametrize("tamper", [False, True])
async def test_source_record_authenticates_the_value(
    monkeypatch: pytest.MonkeyPatch, tamper: bool
) -> None:
    owner = "did:plc:protectedsource"
    uri = build_record_uri(
        build_space_uri(owner, settings.atproto.private_media_space_type, "playback"),
        owner,
        settings.atproto.track_collection,
        "source",
    )
    value: dict[str, Any] = {
        "audioBlob": {
            "$type": "blob",
            "ref": {
                "$link": "bafkreigh2akiscaildcdrw3q4p6vn6c7bbzxwk5xehbim3zbytb5w3tsru"
            },
            "mimeType": "audio/mpeg",
            "size": 123,
        },
        "audioFileId": "verified",
        "fileType": "mp3",
    }
    raw_value = {
        **value,
        "audioBlob": {
            **value["audioBlob"],
            "ref": libipld.decode_multibase(value["audioBlob"]["ref"]["$link"])[1],
        },
    }
    raw_cid = (
        b"\x01\x71\x12\x20"
        + hashlib.sha256(libipld.encode_dag_cbor(raw_value)).digest()
    )
    cid = "b" + base64.b32encode(raw_cid).decode().lower().rstrip("=")
    author_key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(
        protected_audio,
        "_kem_key",
        AsyncMock(return_value=mac._did_key(author_key.public_key())),
    )
    monkeypatch.setattr(
        protected_audio, "_repo_host_url", AsyncMock(return_value="https://source.test")
    )
    monkeypatch.setattr(
        protected_audio,
        "get_space_credential",
        AsyncMock(
            return_value=SpaceCredential(
                token="app-credential",
                key=ec.generate_private_key(ec.SECP256R1()),
                expires_at=time.monotonic() + 300,
            )
        ),
    )

    async def respond(*args: Any, **kwargs: Any) -> httpx.Response:
        header = kwargs["extra_headers"][mac.WANT_MAC_HEADER]
        key_share = header.split('key_share="')[1].rstrip('"')
        secret = mac.decapsulate(author_key, key_share)
        uri_bytes = uri.encode()
        digest = hmac.new(
            secret,
            b"atproto-space-record-v1"
            + struct.pack(">H", len(uri_bytes))
            + uri_bytes
            + raw_cid,
            hashlib.sha256,
        ).digest()
        return httpx.Response(
            200,
            json={
                "uri": uri,
                "cid": cid,
                "value": {**value, "audioFileId": "forged"} if tamper else value,
            },
            headers={
                mac.MAC_HEADER: f'type="atproto-space-record", ver=1, mac=:{base64.b64encode(digest).decode()}:'
            },
        )

    monkeypatch.setattr(protected_audio, "_space_token_request", respond)
    if tamper:
        with pytest.raises(SpaceAccessError, match="does not match its CID"):
            await protected_audio.resolve_protected_audio(uri, owner)
    else:
        audio, received = await protected_audio.resolve_protected_audio(uri, owner)
        assert audio["record_cid"] == cid
        assert received["audioFileId"] == "verified"

"""response MACs for permissioned-space reads, ported from ``@atproto/space``
``kem.ts`` and ``mac.ts`` on the permissioned-data branch."""

import base64
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from atproto_crypto.consts import P256_JWT_ALG
from atproto_crypto.did import format_did_key
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal import Session
from backend._internal.atproto.spaces import client as space_client
from backend._internal.atproto.spaces import mac

SPACE = "at://did:plc:authority/space/fm.example.catalog/main"
WRITER = "did:plc:writer"


def _did_key(key: ec.EllipticCurvePrivateKey) -> str:
    compressed = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.CompressedPoint
    )
    return format_did_key(P256_JWT_ALG, compressed)


def test_kem_matches_the_rfc_9180_vector() -> None:
    """RFC 9180 A.3.1, DHKEM(P-256, HKDF-SHA256), as upstream's kem.test.ts."""
    pk_em = bytes.fromhex(
        "04a92719c6195d5085104f469a8b9814d5838ff72b60501e2c4466e5e67b325ac9"
        "8536d7b61a1af4b78e5b7f951c0900be863c403ce65c9bfcb9382657222d18c4"
    )
    author = ec.derive_private_key(
        int("f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2", 16),
        ec.SECP256R1(),
    )
    key_share = format_did_key(
        P256_JWT_ALG,
        ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), pk_em
        ).public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.CompressedPoint
        ),
    )
    assert mac.decapsulate(author, key_share).hex() == (
        "c0d26aeab536609a572b07695d933b589dcf363ff9d93c93adea537aeabb8cb8"
    )


def test_encapsulation_agrees_with_the_author() -> None:
    author = ec.generate_private_key(ec.SECP256R1())
    encapsulation = mac.encapsulate(_did_key(author))
    assert encapsulation.shared_secret == mac.decapsulate(
        author, encapsulation.key_share
    )


def test_kem_key_must_be_p256() -> None:
    with pytest.raises(mac.SpaceMacError):
        mac.encapsulate("did:key:zQ3shpqvKe7jKxYdPBoJHq9VVNLoqaDkL7GTtsX16eqFKXFjS")


def _commit(**changes: object) -> dict:
    commit = {
        "ver": 1,
        "space": SPACE,
        "repo": WRITER,
        "rev": "3kbcq3p7ad400",
        "data": {"$bytes": base64.b64encode(bytes([1]) * 32).decode().rstrip("=")},
    }
    return {**commit, **changes}


def _mac_for(secret: bytes, commit: dict) -> bytes:
    return mac.compute_commit_mac(
        secret,
        space=commit["space"],
        repo=commit["repo"],
        rev=commit["rev"],
        data=bytes([1]) * 32,
    )


def test_commit_mac_covers_every_field_unambiguously() -> None:
    secret = bytes(range(32))
    commit = _commit()
    mac.verify_commit_mac(secret, commit, _mac_for(secret, commit))
    for tampered in (
        _commit(rev="3kbcq3p7ad401"),
        _commit(repo="did:plc:other"),
        _commit(data={"$bytes": base64.b64encode(bytes([2]) * 32).decode()}),
    ):
        with pytest.raises(mac.SpaceMacError):
            mac.verify_commit_mac(secret, tampered, _mac_for(secret, commit))
    a = mac.compute_commit_mac(
        secret, space=SPACE, repo="did:x:a", rev="3kbc", data=b""
    )
    b = mac.compute_commit_mac(
        secret, space=SPACE, repo="did:x:a3", rev="kbc", data=b""
    )
    assert a != b


def test_headers_round_trip_the_upstream_shapes() -> None:
    assert mac.format_want_mac_header("did:key:zDnaeX") == (
        'type="atproto-space-repo", ver=1, key_share="did:key:zDnaeX"'
    )
    value = base64.b64encode(b"\x00" * 32).decode()
    header = f'type="atproto-space-repo", ver=1, mac=:{value}:'
    assert mac.parse_mac_header(header) == b"\x00" * 32
    for bad in (
        None,
        'type="atproto-space-record", ver=1, mac=:AA==:',
        'type="atproto-space-repo", ver=1',
    ):
        with pytest.raises(mac.SpaceMacError):
            mac.parse_mac_header(bad)


def _session() -> Session:
    return Session(
        session_id="s", did="did:plc:user", handle="user.test", oauth_session={}
    )


@pytest.fixture
def credential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        space_client,
        "get_space_credential",
        AsyncMock(
            return_value=space_client.SpaceCredential(
                token="cred",
                key=ec.generate_private_key(ec.SECP256R1()),
                expires_at=time.monotonic() + 300,
            )
        ),
    )


async def _read_repo_ops(
    monkeypatch: pytest.MonkeyPatch,
    *,
    kem: ec.EllipticCurvePrivateKey | None,
    respond: object,
) -> dict:
    sent: list[dict[str, str] | None] = []

    async def token_request(*args: object, **kwargs: object) -> httpx.Response:
        headers = kwargs.get("extra_headers")
        sent.append(headers)  # type: ignore[arg-type]
        return respond(headers)  # type: ignore[operator]

    monkeypatch.setattr(space_client, "_space_token_request", token_request)
    monkeypatch.setattr(
        space_client, "_kem_key", AsyncMock(return_value=_did_key(kem) if kem else None)
    )
    monkeypatch.setattr(
        space_client, "_repo_host_url", AsyncMock(return_value="https://writer.test")
    )
    result = await space_client.list_space_repo_ops(
        _session(), space=SPACE, repo=WRITER
    )
    result["_sent"] = sent
    return result


def _host_reply(kem: ec.EllipticCurvePrivateKey, *, forge: bool = False):
    def reply(headers: dict[str, str]) -> httpx.Response:
        key_share = headers[mac.WANT_MAC_HEADER].split('key_share="')[1].rstrip('"')
        secret = mac.decapsulate(kem, key_share)
        commit = _commit()
        digest = _mac_for(bytes(32) if forge else secret, commit)
        return httpx.Response(
            200,
            json={"ops": [], "commit": commit},
            headers={
                mac.MAC_HEADER: f'type="atproto-space-repo", ver=1, mac=:{base64.b64encode(digest).decode()}:'
            },
        )

    return reply


async def test_repo_ops_request_and_verify_the_commit_mac(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    kem = ec.generate_private_key(ec.SECP256R1())
    result = await _read_repo_ops(monkeypatch, kem=kem, respond=_host_reply(kem))
    assert result["commit"]["rev"] == "3kbcq3p7ad400"
    [headers] = result["_sent"]
    assert headers[mac.WANT_MAC_HEADER].startswith(
        'type="atproto-space-repo", ver=1, key_share="did:key:z'
    )


async def test_repo_ops_reject_a_commit_whose_mac_does_not_verify(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    kem = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(space_client.SpaceAccessError, match="did not verify"):
        await _read_repo_ops(monkeypatch, kem=kem, respond=_host_reply(kem, forge=True))


async def test_repo_ops_without_a_kem_key_send_no_mac_request(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    result = await _read_repo_ops(
        monkeypatch,
        kem=None,
        respond=lambda headers: httpx.Response(
            200, json={"ops": [], "commit": _commit()}
        ),
    )
    assert result["_sent"] == [None]

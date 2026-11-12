"""response MACs for permissioned-space reads, ported from ``@atproto/space``
``kem.ts`` and ``mac.ts`` on the permissioned-data branch."""

import base64
import hashlib
import hmac
import json
import time
from pathlib import Path
from unittest.mock import AsyncMock

import http_sfv
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


def test_kem_matches_current_sdk_hpke_export_vector() -> None:
    """Upstream 2d4a6736f kem.test.ts vector independently computed by Go HPKE."""
    pk_em = bytes.fromhex(
        "04d804370b7e24b94749eb1dc8df6d4d4a5d75f9effad01739ebcad5c54a40d57aa"
        "a8b4190fc124dbde2e4f1e1d1b012a3bc4038157dc29b55533a932306d8d38d"
    )
    author = ec.derive_private_key(
        int("62c3868357a464f8461d03aa0182c7cebcde841036aea7230ddc7339f1088346", 16),
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
        "2060e0558d1b34c10086bc137f849bb79ba59fcdc30544418e35c9cd301f0d0d"
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


def response_headers(
    request: str, secret: bytes, covered: str, fields: dict
) -> dict[str, str]:
    params = request.split("=", 1)[1]
    dictionary = http_sfv.Dictionary(fields)
    base = f'"{covered}";sf: {dictionary}\n"@signature-params": {params}'.encode()
    signature = base64.b64encode(
        hmac.new(secret, base, hashlib.sha256).digest()
    ).decode()
    return {
        covered: str(dictionary),
        "signature-input": request,
        "signature": f"mac=:{signature}:",
    }


def commit_headers(exchange: mac.Encapsulation, commit: dict) -> dict[str, str]:
    return response_headers(
        mac.format_mac_request(exchange.key_share),
        exchange.shared_secret,
        "atproto-space-commit",
        {**commit, "data": base64.b64decode(commit["data"]["$bytes"] + "=")},
    )


def test_commit_mac_covers_every_field_unambiguously() -> None:
    exchange = mac.Encapsulation("did:key:fixture", bytes(range(32)))
    commit = _commit()
    headers = commit_headers(exchange, commit)
    mac.verify_commit_mac(exchange, commit, headers, space=SPACE, repo=WRITER)
    for tampered in (
        _commit(rev="different"),
        _commit(repo="did:plc:other"),
        _commit(ver=2),
        _commit(data={"$bytes": "AA=="}),
        None,
    ):
        with pytest.raises(mac.SpaceMacError):
            mac.verify_commit_mac(exchange, tampered, headers, space=SPACE, repo=WRITER)


@pytest.mark.parametrize(
    "header", ["signature", "signature-input", "atproto-space-commit"]
)
def test_missing_or_corrupt_proof_fails_closed(header: str) -> None:
    exchange = mac.Encapsulation("did:key:fixture", bytes(range(32)))
    for replacement in (None, "corrupt"):
        headers = commit_headers(exchange, _commit())
        if replacement is None:
            del headers[header]
        else:
            headers[header] = replacement
        with pytest.raises(mac.SpaceMacError):
            mac.verify_commit_mac(
                exchange, _commit(), headers, space=SPACE, repo=WRITER
            )


def test_request_key_binding_and_covered_header_are_required() -> None:
    exchange = mac.Encapsulation("did:key:fixture", bytes(range(32)))
    headers = commit_headers(exchange, _commit())
    for original, replacement in [
        ("did:key:fixture", "did:key:other"),
        (";sf", ""),
        ("atproto-space-commit", "unrelated"),
        (";tag=", ';alg="other";tag='),
    ]:
        altered = {
            **headers,
            "signature-input": headers["signature-input"].replace(
                original, replacement
            ),
        }
        with pytest.raises(mac.SpaceMacError):
            mac.verify_commit_mac(
                exchange, _commit(), altered, space=SPACE, repo=WRITER
            )


def test_record_value_matches_canonical_dag_cbor_with_links_and_bytes() -> None:
    value = {
        "data": {"$bytes": "AQID"},
        "ref": {"$link": "bafkreigh2akiscaildcdrw3q4p6vn6c7bbzxwk5xehbim3zbytb5w3tsru"},
    }
    cid = "bafyreicqq52uip66vysa7hc73yk4g6cphpdyvsxbngsshw73vftwmpicti"
    mac.verify_record_value(value, cid)
    with pytest.raises(mac.SpaceMacError, match="does not match"):
        mac.verify_record_value({**value, "data": {"$bytes": "BAUG"}}, cid)
    with pytest.raises(mac.SpaceMacError, match="does not match"):
        mac.verify_record_value({**value, "ref": {"$bytes": "AQID"}}, cid)


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
        key_share = (
            headers[mac.ACCEPT_SIGNATURE_HEADER].split('keyid="')[1].split('"')[0]
        )
        secret = mac.decapsulate(kem, key_share)
        commit = _commit()
        proof = commit_headers(
            mac.Encapsulation(key_share, bytes(32) if forge else secret), commit
        )
        return httpx.Response(
            200,
            json={"ops": [], "commit": commit},
            headers=proof,
        )

    return reply


async def test_repo_ops_request_and_verify_the_commit_mac(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    kem = ec.generate_private_key(ec.SECP256R1())
    result = await _read_repo_ops(monkeypatch, kem=kem, respond=_host_reply(kem))
    assert result["commit"]["rev"] == "3kbcq3p7ad400"
    [headers] = result["_sent"]
    assert headers[mac.ACCEPT_SIGNATURE_HEADER].startswith(
        'mac=("atproto-space-commit";sf);keyid="did:key:z'
    )


async def test_repo_ops_reject_a_commit_whose_mac_does_not_verify(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    kem = ec.generate_private_key(ec.SECP256R1())
    with pytest.raises(space_client.SpaceAccessError, match="did not verify"):
        await _read_repo_ops(monkeypatch, kem=kem, respond=_host_reply(kem, forge=True))


async def test_repo_ops_without_a_kem_key_fail_closed(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    with pytest.raises(space_client.SpaceAccessError, match="no verification key"):
        await _read_repo_ops(
            monkeypatch,
            kem=None,
            respond=lambda headers: httpx.Response(200, json={"ops": []}),
        )


async def test_repo_ops_without_commit_fail_closed(
    monkeypatch: pytest.MonkeyPatch, credential: None
) -> None:
    with pytest.raises(space_client.SpaceAccessError, match="missing or unexpected"):
        await _read_repo_ops(
            monkeypatch,
            kem=ec.generate_private_key(ec.SECP256R1()),
            respond=lambda headers: httpx.Response(200, json={"ops": []}),
        )


def test_current_sdk_signed_record_and_commit_vectors() -> None:
    fixture = json.loads(
        (Path(__file__).parents[1] / "fixtures/space-mac.json").read_text()
    )
    author = ec.derive_private_key(int(fixture["authorPrivateKey"], 16), ec.SECP256R1())
    secret = mac.decapsulate(author, fixture["keyShare"])
    assert secret.hex() == fixture["sharedSecret"]
    exchange = mac.Encapsulation(fixture["keyShare"], secret)
    commit = fixture["commit"]
    mac.verify_commit_mac(
        exchange,
        commit,
        fixture["commitHeaders"],
        space=commit["space"],
        repo=commit["repo"],
    )
    record = fixture["record"]
    mac.verify_record_value(record["value"], record["cid"])
    mac.verify_record_mac(
        exchange, uri=record["uri"], cid=record["cid"], headers=fixture["recordHeaders"]
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("rev", None),
        ("rev", 42),
        ("rev", ""),
        ("ver", True),
        ("repo", http_sfv.Token(WRITER)),
    ],
)
def test_signed_malformed_commit_metadata_is_rejected(
    field: str, value: object
) -> None:
    exchange = mac.Encapsulation("did:key:fixture", bytes(range(32)))
    commit = _commit()
    signed = {**commit, "data": bytes([1]) * 32}
    if value is None:
        signed.pop(field)
        commit.pop(field)
    else:
        signed[field] = value
        if field == "rev":
            commit[field] = value
    headers = response_headers(
        mac.format_mac_request(exchange.key_share),
        exchange.shared_secret,
        "atproto-space-commit",
        signed,
    )
    with pytest.raises(mac.SpaceMacError):
        mac.verify_commit_mac(exchange, commit, headers, space=SPACE, repo=WRITER)

"""HPKE-exported RFC 9421 response MACs for permissioned-space reads."""

import base64
import hashlib
import hmac
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import http_sfv
import libipld
from atproto_core.cid import CID
from atproto_crypto.consts import P256_JWT_ALG
from atproto_crypto.did import format_did_key, parse_did_key
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDFExpand

COMMIT_MAC_TYPE = "atproto-space-repo"
RECORD_MAC_TYPE = "atproto-space-record"
COMMIT_VERSION = 1
ACCEPT_SIGNATURE_HEADER = "accept-signature"


class SpaceMacError(Exception):
    """A MAC header was missing or malformed, or did not verify."""


@dataclass(frozen=True)
class Encapsulation:
    key_share: str
    shared_secret: bytes


def _p256_key_bytes(did_key: str) -> bytes:
    try:
        parsed = parse_did_key(did_key)
    except Exception as exc:
        raise SpaceMacError(f"invalid KEM key: {did_key}") from exc
    if parsed.jwt_alg != P256_JWT_ALG:
        raise SpaceMacError("KEM key must be a P-256 did:key")
    return parsed.key_bytes


def _derive_shared_secret(dh: bytes, syncer_key: bytes, author_key: bytes) -> bytes:
    kem = b"KEM" + struct.pack(">H", 0x0010)
    suite = b"HPKE" + struct.pack(">HHH", 0x0010, 0x0001, 0xFFFF)

    def extract(suite_id: bytes, salt: bytes, label: bytes, value: bytes) -> bytes:
        return hmac.new(
            salt, b"HPKE-v1" + suite_id + label + value, hashlib.sha256
        ).digest()

    def expand(suite_id: bytes, secret: bytes, label: bytes, info: bytes) -> bytes:
        return HKDFExpand(
            algorithm=hashes.SHA256(),
            length=32,
            info=struct.pack(">H", 32) + b"HPKE-v1" + suite_id + label + info,
        ).derive(secret)

    eae = extract(kem, b"", b"eae_prk", dh)
    kem_secret = expand(kem, eae, b"shared_secret", syncer_key + author_key)
    context = (
        b"\x00"
        + extract(suite, b"", b"psk_id_hash", b"")
        + extract(suite, b"", b"info_hash", b"atproto-mac")
    )
    secret = extract(suite, kem_secret, b"secret", b"")
    exporter = expand(suite, secret, b"exp", context)
    return expand(suite, exporter, b"sec", b"")


def _did_key(public: ec.EllipticCurvePublicKey) -> str:
    compressed = public.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.CompressedPoint
    )
    return format_did_key(P256_JWT_ALG, compressed)


def encapsulate(author_kem_key: str) -> Encapsulation:
    """Syncer side: a fresh key share and the secret it agrees with the author on."""
    author_bytes = _p256_key_bytes(author_kem_key)
    author = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), author_bytes)
    ephemeral = ec.generate_private_key(ec.SECP256R1())
    dh = ephemeral.exchange(ec.ECDH(), author)
    key_share = _did_key(ephemeral.public_key())
    return Encapsulation(
        key_share=key_share,
        shared_secret=_derive_shared_secret(
            dh, _p256_key_bytes(key_share), author_bytes
        ),
    )


def decapsulate(author_kem_key: ec.EllipticCurvePrivateKey, key_share: str) -> bytes:
    """Repo host side of :func:`encapsulate`."""
    syncer_bytes = _p256_key_bytes(key_share)
    syncer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), syncer_bytes)
    dh = author_kem_key.exchange(ec.ECDH(), syncer)
    author_bytes = author_kem_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _derive_shared_secret(dh, syncer_bytes, author_bytes)


def format_mac_request(key_share: str, *, mac_type: str = COMMIT_MAC_TYPE) -> str:
    component = http_sfv.Item(_covered_header(mac_type))
    component.params["sf"] = True
    params = http_sfv.InnerList([component])
    params.params.update({"keyid": key_share, "tag": mac_type})
    return "mac=" + str(params)


def _covered_header(mac_type: str) -> str:
    if mac_type == COMMIT_MAC_TYPE:
        return "atproto-space-commit"
    if mac_type == RECORD_MAC_TYPE:
        return "atproto-space-record"
    raise SpaceMacError("unsupported MAC profile")


def _dictionary(value: str | None) -> http_sfv.Dictionary:
    if not value:
        raise SpaceMacError("missing MAC header")
    result = http_sfv.Dictionary()
    try:
        result.parse(value.encode("ascii"))
    except (ValueError, UnicodeError) as exc:
        raise SpaceMacError("malformed MAC header") from exc
    return result


def _verify_mac(
    exchange: Encapsulation,
    headers: Mapping[str, str],
    mac_type: str,
) -> http_sfv.Dictionary:
    inputs = _dictionary(headers.get("signature-input"))
    signatures = _dictionary(headers.get("signature"))
    tagged = [
        (name, member)
        for name, member in inputs.items()
        if isinstance(member, http_sfv.InnerList)
        and type(member.params.get("tag")) is str
        and member.params.get("tag") == mac_type
    ]
    if len(tagged) != 1:
        raise SpaceMacError("missing or ambiguous MAC signature")
    label, params = tagged[0]
    header = _covered_header(mac_type)
    if (
        len(params) != 1
        or type(params[0].value) is not str
        or params[0].value != header
        or set(params[0].params) != {"sf"}
        or params[0].params["sf"] is not True
        or type(params.params.get("keyid")) is not str
        or params.params.get("keyid") != exchange.key_share
        or params.params.get("alg", "hmac-sha256") != "hmac-sha256"
        or set(params.params) - {"keyid", "tag", "alg"}
    ):
        raise SpaceMacError("unexpected MAC signature parameters")
    signature = signatures.get(label)
    if (
        not isinstance(signature, http_sfv.Item)
        or not isinstance(signature.value, bytes)
        or signature.params
    ):
        raise SpaceMacError("malformed MAC signature")
    fields = _dictionary(headers.get(header))
    base = f'"{header}";sf: {fields}\n"@signature-params": {params}'.encode()
    expected = hmac.new(exchange.shared_secret, base, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, signature.value):
        raise SpaceMacError("response MAC did not verify")
    return fields


def _bare(fields: http_sfv.Dictionary, name: str) -> object:
    item = fields.get(name)
    return item.value if isinstance(item, http_sfv.Item) else None


def _b64(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4), validate=True)


def verify_commit_mac(
    exchange: Encapsulation,
    commit: dict[str, Any] | None,
    headers: Mapping[str, str],
    *,
    space: str,
    repo: str,
) -> None:
    if (
        not isinstance(commit, dict)
        or type(commit.get("ver")) is not int
        or commit["ver"] != COMMIT_VERSION
        or not isinstance(commit.get("rev"), str)
        or not commit["rev"]
        or commit.get("space") != space
        or commit.get("repo") != repo
    ):
        raise SpaceMacError("missing or unexpected space commit")
    fields = _verify_mac(exchange, headers, COMMIT_MAC_TYPE)
    try:
        data = _b64(commit["data"]["$bytes"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SpaceMacError("malformed commit data") from exc
    if (
        type(_bare(fields, "ver")) is not int
        or any(type(_bare(fields, key)) is not str for key in ("space", "repo", "rev"))
        or any(
            _bare(fields, key) != commit.get(key)
            for key in ("ver", "space", "repo", "rev")
        )
        or _bare(fields, "data") != data
        or len(data) != 32
    ):
        raise SpaceMacError("commit does not match its MAC")


def verify_record_mac(
    exchange: Encapsulation,
    *,
    uri: str,
    cid: str,
    headers: Mapping[str, str],
) -> None:
    fields = _verify_mac(exchange, headers, RECORD_MAC_TYPE)
    if (
        type(_bare(fields, "uri")) is not str
        or type(_bare(fields, "cid")) is not str
        or _bare(fields, "uri") != uri
        or _bare(fields, "cid") != cid
    ):
        raise SpaceMacError("record does not match its MAC")


def _ipld_value(value: Any) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$link"}:
            cid = value["$link"]
            CID.decode(cid)
            return libipld.decode_multibase(cid)[1]
        if set(value) == {"$bytes"}:
            decoded = _b64(value["$bytes"])
            try:
                CID.decode(decoded)
            except ValueError:
                return decoded
            raise SpaceMacError("ambiguous binary value in protected audio record")
        return {key: _ipld_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_ipld_value(item) for item in value]
    return value


def verify_record_value(value: dict, cid: str) -> None:
    try:
        expected = CID.decode(cid)
        encoded = libipld.encode_dag_cbor(_ipld_value(value))
        if expected.codec != 0x71 or expected.hash.code != 0x12:
            raise SpaceMacError("unsupported protected record CID")
        if hashlib.sha256(encoded).digest() != expected.hash.digest:
            raise SpaceMacError("record value does not match its CID")
    except (ValueError, TypeError) as exc:
        raise SpaceMacError("malformed protected record value") from exc

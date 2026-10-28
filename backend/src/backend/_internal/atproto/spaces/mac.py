"""Response MACs for permissioned-space reads (``@atproto/space`` ``kem.ts`` / ``mac.ts``).

A syncer reading with a space credential sends ``Atproto-Space-Want-Mac`` with a
fresh P-256 key share; the repo host derives the same shared secret against the
author's ``#atproto_kem`` key and MACs the commit in ``Atproto-Space-Mac``.
"""

import base64
import hashlib
import hmac
import re
import struct
from dataclasses import dataclass
from typing import Any

import libipld
from atproto_core.cid import CID
from atproto_crypto.consts import P256_JWT_ALG
from atproto_crypto.did import format_did_key, parse_did_key
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

COMMIT_MAC_TYPE = "atproto-space-repo"
RECORD_MAC_TYPE = "atproto-space-record"
COMMIT_VERSION = 1
WANT_MAC_HEADER = "atproto-space-want-mac"
MAC_HEADER = "atproto-space-mac"

# RFC 9180 suite id for DHKEM(P-256, HKDF-SHA256)
_KEM_PREFIX = b"HPKE-v1" + b"KEM" + struct.pack(">H", 0x0010)


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
    info = (
        struct.pack(">H", 32) + _KEM_PREFIX + b"shared_secret" + syncer_key + author_key
    )
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"", info=info).derive(
        _KEM_PREFIX + b"eae_prk" + dh
    )


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


def format_want_mac_header(key_share: str, *, mac_type: str = COMMIT_MAC_TYPE) -> str:
    return f'type="{mac_type}", ver={COMMIT_VERSION}, key_share="{key_share}"'


_MAC_FIELDS = re.compile(r'(\w+)=("[^"]*"|:[A-Za-z0-9+/=]*:|\d+)')


def parse_mac_header(value: str | None, *, mac_type: str = COMMIT_MAC_TYPE) -> bytes:
    """The commit MAC carried in an ``Atproto-Space-Mac`` response header."""
    if not value:
        raise SpaceMacError("missing Atproto-Space-Mac header")
    fields = dict(_MAC_FIELDS.findall(value))
    if fields.get("type") != f'"{mac_type}"' or fields.get("ver") != str(
        COMMIT_VERSION
    ):
        raise SpaceMacError(f"unexpected MAC type or version: {value}")
    mac = fields.get("mac", "")
    if not (mac.startswith(":") and mac.endswith(":")):
        raise SpaceMacError("missing or malformed mac")
    return _b64(mac[1:-1])


def _b64(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4))


def _length_prefixed(text: str) -> bytes:
    data = text.encode()
    return struct.pack(">H", len(data)) + data


def compute_commit_mac(
    shared_secret: bytes, *, space: str, repo: str, rev: str, data: bytes
) -> bytes:
    context = (
        f"{COMMIT_MAC_TYPE}-v{COMMIT_VERSION}".encode()
        + _length_prefixed(space)
        + _length_prefixed(repo)
        + _length_prefixed(rev)
    )
    return hmac.new(shared_secret, context + data, hashlib.sha256).digest()


def verify_commit_mac(shared_secret: bytes, commit: dict, mac: bytes) -> None:
    """Check a JSON ``com.atproto.space.defs#commit`` against its MAC."""
    try:
        expected = compute_commit_mac(
            shared_secret,
            space=commit["space"],
            repo=commit["repo"],
            rev=commit["rev"],
            data=_b64(commit["data"]["$bytes"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise SpaceMacError(f"malformed commit: {commit}") from exc
    if not hmac.compare_digest(expected, mac):
        raise SpaceMacError("commit MAC did not verify")


def verify_record_mac(shared_secret: bytes, *, uri: str, cid: str, mac: bytes) -> None:
    if not cid.startswith("b"):
        raise SpaceMacError("record CID is not base32")
    try:
        raw_cid = base64.b32decode(cid[1:].upper() + "=" * (-len(cid[1:]) % 8))
    except ValueError as exc:
        raise SpaceMacError("malformed record CID") from exc
    expected = hmac.new(
        shared_secret,
        f"{RECORD_MAC_TYPE}-v{COMMIT_VERSION}".encode()
        + _length_prefixed(uri)
        + raw_cid,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(expected, mac):
        raise SpaceMacError("record MAC did not verify")


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

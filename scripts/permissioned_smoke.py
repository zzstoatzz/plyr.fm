# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "httpx",
#   "python-dotenv",
#   "atproto @ git+https://github.com/zzstoatzz/atproto@1ad4f176292d688005c6247f1e65f2d2c1057b89",
# ]
# ///
"""end-to-end smoke for the permissioned-spaces private-media flow against a live PDS.

exercises the exact com.atproto.space.* request/response shapes the plyr.fm space
client uses, proving private records + blobs actually store and read back through the
permissioned-space access path. Uses a plain createSession bearer for resident
operations, then exercises the separate ephemeral P-256 key that signs space
credential issuance and credential-gated reads (HTTP message signatures).

run: uv run scripts/permissioned_smoke.py
optional membership leg: ZAT_MEMBER_PDS / ZAT_MEMBER_HANDLE / ZAT_MEMBER_PASSWORD — a
second account on a spaces PDS, added to the first account's member list and read
through its own delegation token.

needs ZAT_TEST_HANDLE / ZAT_TEST_PASSWORD / ZAT_TEST_PDS in .env (a test account on a
ZDS_PERMISSIONED_DATA=true instance).
"""

import base64
import os
import sys

import httpx
from atproto_crypto.consts import P256_CURVE_ORDER, P256_JWT_ALG
from atproto_crypto.did import format_did_key
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from dotenv import load_dotenv

load_dotenv()

PDS = os.environ["ZAT_TEST_PDS"].rstrip("/")
HANDLE = os.environ["ZAT_TEST_HANDLE"]
PASSWORD = os.environ["ZAT_TEST_PASSWORD"]
MEMBER_PDS = os.environ.get("ZAT_MEMBER_PDS", "").rstrip("/")
MEMBER_HANDLE = os.environ.get("ZAT_MEMBER_HANDLE", "")
MEMBER_PASSWORD = os.environ.get("ZAT_MEMBER_PASSWORD", "")

# dev namespace — mirrors ATPROTO_APP_NAMESPACE=fm.plyr.dev locally
SPACE_TYPE = "fm.plyr.dev.privateMedia"
COLLECTION = "fm.plyr.dev.track"
SKEY = "self"


def signed(
    token: str, key: ec.EllipticCurvePrivateKey, audience: str
) -> dict[str, str]:
    """headers for a credential use, signed by the key the credential is bound to."""
    authorization = f"Atproto-Space-Credential {token}"
    params = '("authorization" "atproto-space-audience");tag="atproto-space-credential"'
    base = "\n".join(
        [
            f'"authorization": {authorization}',
            f'"atproto-space-audience": {audience}',
            f'"@signature-params": {params}',
        ]
    )
    r, sig_s = decode_dss_signature(key.sign(base.encode(), ec.ECDSA(hashes.SHA256())))
    sig_s = min(sig_s, P256_CURVE_ORDER - sig_s)
    signature = base64.b64encode(r.to_bytes(32, "big") + sig_s.to_bytes(32, "big"))
    return {
        "authorization": authorization,
        "atproto-space-audience": audience,
        "signature-input": f"atproto-space-credential={params}",
        "signature": f"atproto-space-credential=:{signature.decode()}:",
    }


def credential_request(
    space_uri: str, delegation_token: str
) -> tuple[dict, ec.EllipticCurvePrivateKey]:
    """the unsigned getSpaceCredential body, and the key it binds the credential to."""
    key = ec.generate_private_key(ec.SECP256R1())
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.CompressedPoint
    )
    body = {
        "space": space_uri,
        "credentialKid": format_did_key(P256_JWT_ALG, public),
        "delegationToken": delegation_token,
    }
    return body, key


def xrpc(
    client: httpx.Client, method: str, name: str, *, token: str, **kw
) -> httpx.Response:
    headers = {"authorization": f"Bearer {token}"}
    url = f"{PDS}/xrpc/{name}"
    if method == "GET":
        return client.get(url, headers=headers, params=kw.get("params"))
    return client.post(url, headers=headers, json=kw.get("json"))


def member_reads(
    c: httpx.Client, member_token: str, space_uri: str, owner_did: str, blob_cid: str
) -> int:
    """mint a credential for the member and range-read the owner's blob; return status."""
    delegation = c.get(
        f"{MEMBER_PDS}/xrpc/com.atproto.space.getDelegationToken",
        headers={"authorization": f"Bearer {member_token}"},
        params={"space": space_uri},
    )
    if delegation.status_code != 200:
        return delegation.status_code
    credential_url = f"{PDS}/xrpc/com.atproto.space.getSpaceCredential"
    body, key = credential_request(space_uri, delegation.json()["token"])
    cred = c.post(credential_url, json=body)
    if cred.status_code != 200:
        return cred.status_code
    blob_url = f"{PDS}/xrpc/com.atproto.space.getBlob"
    got = c.get(
        blob_url,
        headers={
            **signed(cred.json()["credential"], key, audience=owner_did),
            "range": "bytes=0-3",
        },
        params={"space": space_uri, "repo": owner_did, "cid": blob_cid},
    )
    return got.status_code


def membership_leg(
    c: httpx.Client, owner_token: str, owner_did: str, space_uri: str, blob_cid: str
) -> None:
    """a second account on a spaces PDS: refused, added, reads, removed, refused."""
    session = c.post(
        f"{MEMBER_PDS}/xrpc/com.atproto.server.createSession",
        json={"identifier": MEMBER_HANDLE, "password": MEMBER_PASSWORD},
    )
    session.raise_for_status()
    member_did = session.json()["did"]
    member_token = session.json()["accessJwt"]
    print(f"✓ member session  did={member_did}")

    xrpc(
        c,
        "POST",
        "com.atproto.memberspace.removeMember",
        token=owner_token,
        json={"space": space_uri, "did": member_did},
    )
    before = member_reads(c, member_token, space_uri, owner_did, blob_cid)
    assert before == 403, f"non-member read should be refused, got {before}"
    print("✓ non-member refused (403)")

    added = xrpc(
        c,
        "POST",
        "com.atproto.memberspace.putMember",
        token=owner_token,
        json={"space": space_uri, "did": member_did, "read": True, "write": False},
    )
    added.raise_for_status()
    members = xrpc(
        c,
        "GET",
        "com.atproto.memberspace.listMembers",
        token=owner_token,
        params={"space": space_uri, "limit": 100},
    )
    members.raise_for_status()
    assert member_did in members.text, members.text
    print("✓ putMember + listMembers")

    during = member_reads(c, member_token, space_uri, owner_did, blob_cid)
    assert during == 206, f"member read should succeed, got {during}"
    print("✓ member reads the owner's blob via its own delegation token (206)")

    removed = xrpc(
        c,
        "POST",
        "com.atproto.memberspace.removeMember",
        token=owner_token,
        json={"space": space_uri, "did": member_did},
    )
    removed.raise_for_status()
    after = member_reads(c, member_token, space_uri, owner_did, blob_cid)
    assert after == 403, (
        f"removed member should be refused a new credential, got {after}"
    )
    print("✓ removed member refused a fresh credential (403)")


def main() -> int:
    c = httpx.Client(timeout=30)

    session = c.post(
        f"{PDS}/xrpc/com.atproto.server.createSession",
        json={"identifier": HANDLE, "password": PASSWORD},
    )
    session.raise_for_status()
    did = session.json()["did"]
    token = session.json()["accessJwt"]
    print(f"✓ session  did={did}")

    space_uri = f"at://{did}/space/{SPACE_TYPE}/{SKEY}"

    # capability probe: listSpaces should dispatch for real
    probe = xrpc(
        c,
        "GET",
        "com.atproto.space.listSpaces",
        token=token,
        params={"did": did, "spaceType": SPACE_TYPE},
    )
    assert probe.status_code == 200, (
        f"capability probe failed: {probe.status_code} {probe.text}"
    )
    print("✓ capability probe → supported")

    # upload a tiny audio blob to the account blobstore (standard repo.uploadBlob)
    audio = b"RIFF\x24\x00\x00\x00WAVEfmt private-media smoke"
    blob = c.post(
        f"{PDS}/xrpc/com.atproto.repo.uploadBlob",
        headers={"authorization": f"Bearer {token}", "content-type": "audio/wav"},
        content=audio,
    )
    blob.raise_for_status()
    blob_ref = blob.json()["blob"]
    blob_cid = blob_ref["ref"]["$link"]
    print(f"✓ uploadBlob  cid={blob_cid}")

    # create (or find) the personal private-media space
    created = xrpc(
        c,
        "POST",
        "com.atproto.space.createSpace",
        token=token,
        json={
            "spaceType": SPACE_TYPE,
            "skey": SKEY,
            "policy": {"$type": "com.atproto.memberspace.policy"},
        },
    )
    if created.status_code == 400 and "SpaceAlreadyExists" in created.text:
        print("✓ createSpace → already exists (idempotent)")
    else:
        created.raise_for_status()
        assert f'"uri":"{space_uri}"' in created.text, created.text
        print(f"✓ createSpace  uri={space_uri}")

    # write the private track record (reuses the fm.plyr track lexicon body)
    record = {
        "$type": COLLECTION,
        "title": "private smoke",
        "artist": HANDLE,
        "fileType": "wav",
        "createdAt": "2026-06-07T00:00:00Z",
        "audioBlob": blob_ref,
    }
    rec = xrpc(
        c,
        "POST",
        "com.atproto.space.createRecord",
        token=token,
        json={
            "space": space_uri,
            "repo": did,
            "collection": COLLECTION,
            "rkey": "smoke-one",
            "record": record,
        },
    )
    rec_uri = f"{space_uri}/{did}/{COLLECTION}/smoke-one"
    if rec.status_code == 400 and "RecordAlreadyExists" in rec.text:
        print("✓ createRecord → already exists (left by an interrupted run)")
    else:
        assert rec.status_code == 200, rec.text
        assert rec.json()["uri"] == rec_uri, rec.text
        print(f"✓ createRecord  uri={rec_uri}")

    got = xrpc(
        c,
        "GET",
        "com.atproto.space.getRecord",
        token=token,
        params={
            "space": space_uri,
            "repo": did,
            "collection": COLLECTION,
            "rkey": "smoke-one",
        },
    )
    got.raise_for_status()
    assert "private smoke" in got.text, got.text
    print("✓ getRecord round-trips")

    listed = xrpc(
        c,
        "GET",
        "com.atproto.space.listRecords",
        token=token,
        params={"space": space_uri, "repo": did, "collection": COLLECTION, "limit": 10},
    )
    listed.raise_for_status()
    print(f"✓ listRecords  {listed.text[:120]}")

    # credential flow: OAuth-ish bearer -> delegation token -> space credential
    delegation_resp = xrpc(
        c,
        "GET",
        "com.atproto.space.getDelegationToken",
        token=token,
        params={"space": space_uri},
    )
    delegation_resp.raise_for_status()
    delegation_token = delegation_resp.json()["token"]
    print("✓ getDelegationToken")

    credential_url = f"{PDS}/xrpc/com.atproto.space.getSpaceCredential"
    body, credential_key = credential_request(space_uri, delegation_token)
    cred_resp = c.post(credential_url, json=body)
    cred_resp.raise_for_status()
    credential = cred_resp.json()["credential"]
    print("✓ getSpaceCredential")

    # read the blob THROUGH the permissioned path using the space credential + Range
    blob_url = f"{PDS}/xrpc/com.atproto.space.getBlob"
    blob_get = c.get(
        blob_url,
        headers={
            **signed(credential, credential_key, audience=did),
            "range": "bytes=0-3",
        },
        params={"space": space_uri, "repo": did, "cid": blob_cid},
    )
    assert blob_get.status_code == 206, (
        f"getBlob (credential, range) → {blob_get.status_code} {blob_get.text}"
    )
    assert len(blob_get.content) == 4, blob_get.content
    print(f"✓ getBlob via space credential (206, {len(blob_get.content)} bytes)")

    if MEMBER_PDS and MEMBER_HANDLE and MEMBER_PASSWORD:
        membership_leg(c, token, did, space_uri, blob_cid)
    else:
        print("· membership leg skipped (set ZAT_MEMBER_PDS/HANDLE/PASSWORD)")

    print(
        "\nPASS — private media stored and read back through the permissioned-space path"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

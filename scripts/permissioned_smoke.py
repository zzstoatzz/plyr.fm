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
operations, then exercises the proposal's separate ephemeral DPoP key for space
credential issuance and credential-gated reads.

run: uv run scripts/permissioned_smoke.py
optional membership leg: ZAT_MEMBER_PDS / ZAT_MEMBER_HANDLE / ZAT_MEMBER_PASSWORD — a
second account on a spaces PDS, added to the first account's member list and read
through its own delegation token.

needs ZAT_TEST_HANDLE / ZAT_TEST_PASSWORD / ZAT_TEST_PDS in .env (a test account on a
ZDS_PERMISSIONED_DATA=true instance).
"""

import os
import sys

import httpx
from atproto_oauth.dpop import DPoPManager
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
    key = DPoPManager.generate_keypair()
    cred = c.post(
        credential_url,
        headers={
            "authorization": f"Bearer {delegation.json()['token']}",
            "dpop": DPoPManager.create_proof(
                method="POST", url=credential_url, private_key=key
            ),
        },
        json={"space": space_uri},
    )
    if cred.status_code != 200:
        return cred.status_code
    blob_url = f"{PDS}/xrpc/com.atproto.space.getBlob"
    got = c.get(
        blob_url,
        headers={
            "authorization": f"DPoP {cred.json()['credential']}",
            "dpop": DPoPManager.create_proof(
                method="GET",
                url=blob_url,
                private_key=key,
                access_token=cred.json()["credential"],
            ),
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
        "com.atproto.simplespace.removeMember",
        token=owner_token,
        json={"space": space_uri, "did": member_did},
    )
    before = member_reads(c, member_token, space_uri, owner_did, blob_cid)
    assert before == 403, f"non-member read should be refused, got {before}"
    print("✓ non-member refused (403)")

    added = xrpc(
        c,
        "POST",
        "com.atproto.simplespace.addMember",
        token=owner_token,
        json={"space": space_uri, "did": member_did},
    )
    added.raise_for_status()
    members = xrpc(
        c,
        "GET",
        "com.atproto.simplespace.listMembers",
        token=owner_token,
        params={"space": space_uri, "limit": 100},
    )
    members.raise_for_status()
    assert member_did in members.text, members.text
    print("✓ addMember + listMembers")

    during = member_reads(c, member_token, space_uri, owner_did, blob_cid)
    assert during == 206, f"member read should succeed, got {during}"
    print("✓ member reads the owner's blob via its own delegation token (206)")

    removed = xrpc(
        c,
        "POST",
        "com.atproto.simplespace.removeMember",
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
        params={"did": did, "type": SPACE_TYPE},
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
        "com.atproto.simplespace.createSpace",
        token=token,
        json={
            "type": SPACE_TYPE,
            "skey": SKEY,
            "policy": {"$type": "com.atproto.simplespace.defs#memberListPolicy"},
            "appAccess": {"$type": "com.atproto.simplespace.defs#open"},
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
    rec.raise_for_status()
    rec_uri = rec.json()["uri"]
    assert rec_uri == f"{space_uri}/{did}/{COLLECTION}/smoke-one", rec.text
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
    credential_key = DPoPManager.generate_keypair()
    issuance_proof = DPoPManager.create_proof(
        method="POST",
        url=credential_url,
        private_key=credential_key,
    )
    cred_resp = c.post(
        credential_url,
        headers={
            "authorization": f"Bearer {delegation_token}",
            "dpop": issuance_proof,
        },
        json={"space": space_uri},
    )
    cred_resp.raise_for_status()
    credential = cred_resp.json()["credential"]
    print("✓ getSpaceCredential")

    # read the blob THROUGH the permissioned path using the space credential + Range
    blob_url = f"{PDS}/xrpc/com.atproto.space.getBlob"
    read_proof = DPoPManager.create_proof(
        method="GET",
        url=blob_url,
        private_key=credential_key,
        access_token=credential,
    )
    blob_get = c.get(
        blob_url,
        headers={
            "authorization": f"DPoP {credential}",
            "dpop": read_proof,
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

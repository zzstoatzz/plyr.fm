# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx", "python-dotenv"]
# ///
"""end-to-end smoke for the permissioned-spaces private-media flow against a live PDS.

exercises the exact com.atproto.space.* request/response shapes the plyr.fm space
client uses, proving private records + blobs actually store and read back through the
permissioned-space access path. uses a plain createSession bearer (scope
com.atproto.access bypasses ZDS granular space-scope checks) so it can run without the
full OAuth/DPoP plumbing.

run: uv run scripts/permissioned_smoke.py
needs ZAT_TEST_HANDLE / ZAT_TEST_PASSWORD / ZAT_TEST_PDS in .env (a test account on a
ZDS_PERMISSIONED_DATA=true instance).
"""

import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

PDS = os.environ["ZAT_TEST_PDS"].rstrip("/")
HANDLE = os.environ["ZAT_TEST_HANDLE"]
PASSWORD = os.environ["ZAT_TEST_PASSWORD"]

# dev namespace — mirrors ATPROTO_APP_NAMESPACE=fm.plyr.dev locally
SPACE_TYPE = "fm.plyr.dev.privateMedia"
COLLECTION = "fm.plyr.dev.track"
SKEY = "self"
CLIENT_ID = "did:web:plyr.fm"


def xrpc(
    client: httpx.Client, method: str, name: str, *, token: str, **kw
) -> httpx.Response:
    headers = {"authorization": f"Bearer {token}"}
    url = f"{PDS}/xrpc/{name}"
    if method == "GET":
        return client.get(url, headers=headers, params=kw.get("params"))
    return client.post(url, headers=headers, json=kw.get("json"))


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

    space_uri = f"ats://{did}/{SPACE_TYPE}/{SKEY}"

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
        "com.atproto.space.createSpace",
        token=token,
        json={
            "did": did,
            "type": SPACE_TYPE,
            "skey": SKEY,
            "managingApp": CLIENT_ID,
            "isPublic": False,
            "appAccessMode": "allow",
            "appExceptions": [],
        },
    )
    if created.status_code == 400 and "SpaceAlreadyExists" in created.text:
        print("✓ createSpace → already exists (idempotent)")
    else:
        created.raise_for_status()
        assert created.json()["uri"] == space_uri, created.text
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

    # credential flow: OAuth-ish bearer -> member grant -> space credential
    grant_resp = xrpc(
        c,
        "GET",
        "com.atproto.space.getMemberGrant",
        token=token,
        params={"space": space_uri},
    )
    grant_resp.raise_for_status()
    grant = grant_resp.json()["grant"]
    print("✓ getMemberGrant")

    cred_resp = c.post(
        f"{PDS}/xrpc/com.atproto.space.getSpaceCredential",
        headers={"authorization": f"Bearer {grant}"},
        json={"space": space_uri},
    )
    cred_resp.raise_for_status()
    credential = cred_resp.json()["credential"]
    print("✓ getSpaceCredential")

    # read the blob THROUGH the permissioned path using the space credential + Range
    blob_get = c.get(
        f"{PDS}/xrpc/com.atproto.space.getBlob",
        headers={"authorization": f"Bearer {credential}", "range": "bytes=0-3"},
        params={"space": space_uri, "repo": did, "cid": blob_cid},
    )
    assert blob_get.status_code == 206, (
        f"getBlob (credential, range) → {blob_get.status_code} {blob_get.text}"
    )
    assert len(blob_get.content) == 4, blob_get.content
    print(f"✓ getBlob via space credential (206, {len(blob_get.content)} bytes)")

    print(
        "\nPASS — private media stored and read back through the permissioned-space path"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""client for the permissioned-data space surfaces.

owner/author writes go through the DPoP-protected OAuth path
([make_pds_request][backend._internal.atproto.client.make_pds_request]); the
credential exchange and credential-gated reads use plain Bearer tokens
(delegation tokens and space credentials are JWTs, not DPoP-bound), so those go
through a small raw-bearer helper.

read path (per permissioned-data diary 6):

    user OAuth -> getDelegationToken (requester PDS, DPoP) -> getSpaceCredential
    (space authority, plain Bearer token) -> getRecord / getBlob
    (plain Bearer credential)
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from atproto_oauth.security import is_safe_url

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.spaces.uris import (
    build_space_uri,
    parse_space_record_uri,
)
from backend.config import settings

logger = logging.getLogger(__name__)

# space credentials are "a couple of hours"; refresh well under that and renew
# eagerly on a read rejection.
_CREDENTIAL_TTL_SECONDS = 50 * 60


class SpaceAccessError(Exception):
    """the space owner refused a credential (AppNotPermitted, NotAMember, ...)."""


def _pds_url(auth_session: AuthSession) -> str:
    pds_url = (auth_session.oauth_session or {}).get("pds_url")
    if not pds_url:
        raise ValueError(f"no pds_url on session for {auth_session.did}")
    return pds_url


async def _raw_bearer_request(
    pds_url: str,
    method: str,
    endpoint: str,
    bearer: str,
    *,
    json: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> httpx.Response:
    """call XRPC with a plain Bearer token (delegation token / space credential)."""
    url = f"{pds_url}/xrpc/{endpoint}"
    if not is_safe_url(url):
        raise ValueError(f"unsafe PDS URL: {url}")
    async with httpx.AsyncClient(timeout=30) as http:
        return await http.request(
            method,
            url,
            headers={"authorization": f"Bearer {bearer}"},
            json=json,
            params=params,
        )


# --- space lifecycle + record writes (owner/author, DPoP OAuth) ---------------


async def ensure_personal_space(
    auth_session: AuthSession,
    *,
    space_type: str | None = None,
    skey: str = "self",
) -> str:
    """create (or find) the caller's artist-owned personal space; return its URI.

    owner DID = the artist's DID. the space is owner-only: the protocol no longer
    has a reader member list (#1573), and private-space credentials are owner-only
    by default, so for this MVP the owner is the sole reader. any broader access
    (label/supporter rosters) is plyr.fm app-layer state, not a PDS member list.
    `appAccess:{"type":"open"}` leaves plyr.fm's OAuth client allowed for the
    credential exchange.
    """
    space_type = space_type or settings.atproto.private_media_space_type
    space_uri = build_space_uri(auth_session.did, space_type, skey)
    try:
        await make_pds_request(
            auth_session,
            "POST",
            "com.atproto.simplespace.createSpace",
            payload={
                "type": space_type,
                "skey": skey,
                "managingApp": settings.atproto.client_id,
                "policy": "member-list",
                "appAccess": {"type": "open"},
            },
            # The returned config is not needed. Current ZDS appends one extra
            # closing brace to this otherwise-successful response, so decoding
            # it would turn a created space into a failed upload.
            parse_response=False,
        )
    except Exception as exc:
        if "SpaceAlreadyExists" not in str(exc):
            raise
    return space_uri


async def create_space_record(
    auth_session: AuthSession,
    *,
    space: str,
    collection: str,
    record: dict[str, Any],
    rkey: str | None = None,
) -> tuple[str, str]:
    """write a record into the caller's permissioned repo within `space`.

    uses putRecord when an rkey is supplied (idempotent), else createRecord.
    returns (record_uri, cid).
    """
    payload: dict[str, Any] = {
        "space": space,
        "repo": auth_session.did,
        "collection": collection,
        "record": record,
    }
    if rkey:
        payload["rkey"] = rkey
        endpoint = "com.atproto.space.putRecord"
    else:
        endpoint = "com.atproto.space.createRecord"
    result = await make_pds_request(auth_session, "POST", endpoint, payload=payload)
    return result["uri"], result["cid"]


async def delete_space_record(auth_session: AuthSession, record_uri: str) -> None:
    """delete a record from its permissioned space."""
    record = parse_space_record_uri(record_uri)
    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.space.deleteRecord",
        payload={
            "space": record.space,
            "repo": record.author_did,
            "collection": record.collection,
            "rkey": record.rkey,
        },
        success_codes=(200, 201, 204),
    )


# --- credential exchange (diary-6 read path) ----------------------------------

# per-process cache: space credentials are owner-signed and client-id-bound, so
# they're reusable across reads of the same space until they expire.
_credential_cache: dict[str, tuple[str, float]] = {}


async def _mint_credential(auth_session: AuthSession, space: str) -> str:
    pds_url = _pds_url(auth_session)
    delegation_resp = await make_pds_request(
        auth_session,
        "GET",
        "com.atproto.space.getDelegationToken",
        params={"space": space},
    )
    delegation_token = delegation_resp["token"]

    # exchange the delegation token (plain Bearer) for an authority-signed
    # space credential. plyr.fm has no notification receiver to register.
    cred_resp = await _raw_bearer_request(
        pds_url,
        "POST",
        "com.atproto.space.getSpaceCredential",
        delegation_token,
        json={"space": space},
    )
    if cred_resp.status_code != 200:
        body = cred_resp.text
        refused_errors = (
            "AppNotPermitted",
            "AppNotAuthorized",
            "NotAMember",
            "NotAuthorized",
            "NotPermitted",
            "SpaceDeleted",
            "UserNotAuthorized",
        )
        if any(error in body for error in refused_errors):
            raise SpaceAccessError(f"space authority refused credential: {body}")
        raise Exception(f"getSpaceCredential failed: {cred_resp.status_code} {body}")
    return cred_resp.json()["credential"]


async def get_space_credential(
    auth_session: AuthSession, space: str, *, force_refresh: bool = False
) -> str:
    """obtain a space credential for `space`, minting+caching or renewing as needed."""
    now = time.monotonic()
    if not force_refresh and (cached := _credential_cache.get(space)):
        credential, expires_at = cached
        if expires_at > now:
            return credential
    credential = await _mint_credential(auth_session, space)
    _credential_cache[space] = (credential, now + _CREDENTIAL_TTL_SECONDS)
    return credential


@asynccontextmanager
async def open_space_blob(
    auth_session: AuthSession,
    *,
    space: str,
    repo: str,
    cid: str,
    range_header: str | None = None,
) -> AsyncIterator[httpx.Response]:
    """stream a blob through the permissioned-space path using a space credential.

    yields the upstream streaming response (status, headers, body) so the caller
    can relay Range/206 semantics. renews the credential once on a 401/InvalidToken.
    """
    pds_url = _pds_url(auth_session)
    url = f"{pds_url}/xrpc/com.atproto.space.getBlob"
    if not is_safe_url(url):
        raise ValueError(f"unsafe PDS URL: {url}")
    params = {"space": space, "repo": repo, "cid": cid}

    async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as http:
        for attempt in range(2):
            credential = await get_space_credential(
                auth_session, space, force_refresh=attempt > 0
            )
            headers = {"authorization": f"Bearer {credential}"}
            if range_header:
                headers["range"] = range_header
            req = http.build_request("GET", url, headers=headers, params=params)
            resp = await http.send(req, stream=True)
            if resp.status_code == 401 and attempt == 0:
                await resp.aclose()
                continue  # stale credential — renew and retry once
            try:
                yield resp
            finally:
                await resp.aclose()
            return

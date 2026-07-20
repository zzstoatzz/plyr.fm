"""Client for the Proposal-0016 permissioned-data surfaces.

owner/author writes go through the DPoP-protected OAuth path
([make_pds_request][backend._internal.atproto.client.make_pds_request]); the
credential exchange and credential-gated reads use plain Bearer tokens
(delegation tokens and space credentials are JWTs, not DPoP-bound), so those go
through a small raw-bearer helper.

Read path:

    user OAuth -> getDelegationToken (requester PDS, DPoP) -> getSpaceCredential
    (space authority, delegation token + optional client attestation) -> reads
    (plain Bearer credential)
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from atproto_identity.did.resolver import AsyncDidResolver
from atproto_oauth.security import is_safe_url

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.spaces.uris import (
    build_space_uri,
    parse_space_record_uri,
    parse_space_uri,
)
from backend._internal.auth.oauth import create_space_client_attestation
from backend.config import settings

logger = logging.getLogger(__name__)

# space credentials are "a couple of hours"; refresh well under that and renew
# eagerly on a read rejection.
_CREDENTIAL_TTL_SECONDS = 50 * 60


class SpaceAccessError(Exception):
    """the space owner refused a credential (AppNotPermitted, NotAMember, ...)."""


async def _resolve_did_service(did: str, fragment: str) -> str:
    """Resolve a DID service, falling back to its PDS for space hosting."""
    document = await AsyncDidResolver().resolve(did)
    if document is None:
        raise ValueError(f"could not resolve DID document for {did}")

    endpoint: str | None = None
    for service in document.service or []:
        if service.id in (fragment, f"{did}{fragment}"):
            endpoint = service.service_endpoint
            break
    if endpoint is None and fragment == "#atproto_space_host":
        endpoint = document.get_pds_endpoint()
    if endpoint is None:
        raise ValueError(f"no {fragment} service for {did}")
    endpoint = endpoint.rstrip("/")
    if not is_safe_url(endpoint):
        raise ValueError(f"unsafe {fragment} endpoint for {did}")
    return endpoint


async def _space_host_url(space: str) -> str:
    authority = parse_space_uri(space).owner_did
    return await _resolve_did_service(authority, "#atproto_space_host")


async def _repo_host_url(repo: str) -> str:
    return await _resolve_did_service(repo, "#atproto_pds")


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
    skey: str = "self",
) -> str:
    """create (or find) the caller's artist-owned personal space; return its URI.

    The required ``simplespace`` management layer uses a member-list policy for
    this owner-only MVP. App access stays open so local/public OAuth clients can
    exercise the experimental feature without a confidential-client key.
    """
    space_type = settings.atproto.private_media_space_type
    space_uri = build_space_uri(auth_session.did, space_type, skey)
    try:
        await make_pds_request(
            auth_session,
            "POST",
            "com.atproto.simplespace.createSpace",
            payload={
                "did": auth_session.did,
                "type": space_type,
                "skey": skey,
                "config": {
                    "policy": "member-list",
                    "appAccess": {"$type": "com.atproto.simplespace.defs#open"},
                },
            },
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


# --- credential exchange ------------------------------------------------------

# per-process cache: space credentials are owner-signed and client-id-bound, so
# they're reusable across reads of the same space until they expire.
_credential_cache: dict[str, tuple[str, float]] = {}


async def _mint_credential(auth_session: AuthSession, space: str) -> str:
    delegation_resp = await make_pds_request(
        auth_session,
        "GET",
        "com.atproto.space.getDelegationToken",
        params={"space": space},
    )
    delegation_token = delegation_resp["token"]

    authority = parse_space_uri(space).owner_did
    audience = f"{authority}#atproto_space_host"
    payload = {"space": space}
    if attestation := create_space_client_attestation(audience):
        payload["clientAttestation"] = attestation

    # Credential issuance happens on the resolved space host, which may differ
    # from both the user's PDS and each writer's repo host.
    cred_resp = await _raw_bearer_request(
        await _space_host_url(space),
        "POST",
        "com.atproto.space.getSpaceCredential",
        delegation_token,
        json=payload,
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
    pds_url = await _repo_host_url(repo)
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


async def list_spaces(
    auth_session: AuthSession,
    *,
    space_type: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """List permissioned spaces materialized for the authenticated user."""
    params: dict[str, Any] = {"did": auth_session.did, "limit": limit}
    if space_type:
        params["type"] = space_type
    return await make_pds_request(
        auth_session,
        "GET",
        "com.atproto.space.listSpaces",
        params=params,
    )


async def _credential_read(
    auth_session: AuthSession,
    *,
    host_url: str,
    endpoint: str,
    space: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Perform a JSON space read, renewing once when the credential is stale."""
    for attempt in range(2):
        credential = await get_space_credential(
            auth_session, space, force_refresh=attempt > 0
        )
        response = await _raw_bearer_request(
            host_url,
            "GET",
            endpoint,
            credential,
            params=params,
        )
        if response.status_code == 401 and attempt == 0:
            continue
        if response.status_code != 200:
            raise SpaceAccessError(
                f"{endpoint} failed: {response.status_code} {response.text}"
            )
        return response.json()
    raise SpaceAccessError(f"{endpoint} rejected renewed credential")


async def list_space_repos(
    auth_session: AuthSession,
    space: str,
    *,
    limit: int = 50,
) -> dict[str, Any]:
    """Discover the writer set for a space from its authority host."""
    return await _credential_read(
        auth_session,
        host_url=await _space_host_url(space),
        endpoint="com.atproto.space.listRepos",
        space=space,
        params={"space": space, "limit": limit},
    )


async def list_space_records(
    auth_session: AuthSession,
    *,
    space: str,
    repo: str,
    collection: str | None = None,
    limit: int = 100,
    exclude_values: bool = False,
) -> dict[str, Any]:
    """Read records directly from a writer's repo host."""
    params: dict[str, Any] = {
        "space": space,
        "repo": repo,
        "limit": limit,
        "excludeValues": exclude_values,
    }
    if collection:
        params["collection"] = collection
    return await _credential_read(
        auth_session,
        host_url=await _repo_host_url(repo),
        endpoint="com.atproto.space.listRecords",
        space=space,
        params=params,
    )


async def list_space_repo_ops(
    auth_session: AuthSession,
    *,
    space: str,
    repo: str,
    since: str,
    limit: int = 500,
) -> dict[str, Any]:
    """Pull incremental operations directly from a writer's repo host."""
    return await _credential_read(
        auth_session,
        host_url=await _repo_host_url(repo),
        endpoint="com.atproto.space.listRepoOps",
        space=space,
        params={
            "space": space,
            "repo": repo,
            "since": since,
            "limit": limit,
        },
    )

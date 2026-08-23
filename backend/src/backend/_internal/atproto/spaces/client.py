"""Client for the Proposal-0016 permissioned-data surfaces.

Owner/author writes go through the DPoP-protected OAuth path
([make_pds_request][backend._internal.atproto.client.make_pds_request]). Space
credentials use a separate ephemeral DPoP key generated during credential
exchange and retained with the credential for subsequent reads.

Read path:

    user OAuth -> getDelegationToken (requester PDS, DPoP) -> getSpaceCredential
    (space authority, delegation token + DPoP proof + optional client
    attestation) -> reads (DPoP-bound space credential)
"""

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
from atproto_identity.did.resolver import AsyncDidResolver
from atproto_oauth.dpop import DPoPManager
from atproto_oauth.security import is_safe_url
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey

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


def _space_dpop_headers(
    method: str,
    url: str,
    token: str,
    dpop_key: EllipticCurvePrivateKey,
    *,
    issuance: bool = False,
) -> dict[str, str]:
    proof = DPoPManager.create_proof(
        method=method,
        url=url,
        private_key=dpop_key,
        access_token=None if issuance else token,
    )
    scheme = "Bearer" if issuance else "DPoP"
    return {
        "authorization": f"{scheme} {token}",
        "dpop": proof,
    }


async def _space_token_request(
    service_url: str,
    method: str,
    endpoint: str,
    token: str,
    dpop_key: EllipticCurvePrivateKey,
    *,
    issuance: bool = False,
    json: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> httpx.Response:
    """Call a permissioned XRPC with its operation-specific DPoP proof."""
    url = f"{service_url}/xrpc/{endpoint}"
    if not is_safe_url(url):
        raise ValueError(f"unsafe service URL: {url}")
    headers = _space_dpop_headers(method, url, token, dpop_key, issuance=issuance)
    async with httpx.AsyncClient(timeout=30) as http:
        return await http.request(
            method,
            url,
            headers=headers,
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

    The space is anchored on the authenticated DID. The ``simplespace``
    management layer uses ``memberListPolicy`` for this owner-only MVP; the
    authority is authorized on its own member-list space without an explicit
    ``addMember``. App access stays open so local/public OAuth clients can
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
                "type": space_type,
                "skey": skey,
                "policy": {"$type": "com.atproto.simplespace.defs#memberListPolicy"},
                "appAccess": {"$type": "com.atproto.simplespace.defs#open"},
            },
        )
    except Exception as exc:
        if "SpaceAlreadyExists" not in str(exc):
            raise
    return space_uri


async def add_space_member(auth_session: AuthSession, *, space: str, did: str) -> None:
    """put ``did`` on the space's member list. Authority-only on the space host."""
    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.simplespace.addMember",
        payload={"space": space, "did": did},
    )


async def remove_space_member(
    auth_session: AuthSession, *, space: str, did: str
) -> None:
    """take ``did`` off the member list and forget the credential this process
    minted for it. The PDS stops issuing new credentials at once; one already
    issued lasts until its host's lifetime runs out (the protocol's default is
    two hours)."""
    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.simplespace.removeMember",
        payload={"space": space, "did": did},
    )
    forget_credential(did, space)


async def list_space_members(
    auth_session: AuthSession, *, space: str, cursor: str | None = None
) -> tuple[list[str], str | None]:
    """one page of the member list (zds caps a page at 100). Authority-only."""
    params: dict[str, Any] = {"space": space, "limit": 100}
    if cursor:
        params["cursor"] = cursor
    result = await make_pds_request(
        auth_session,
        "GET",
        "com.atproto.simplespace.listMembers",
        params=params,
    )
    return [m["did"] for m in result.get("members", [])], result.get("cursor")


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


@dataclass(frozen=True)
class SpaceCredential:
    token: str
    dpop_key: EllipticCurvePrivateKey
    expires_at: float


# Per-process cache. Keep the proof key and credential together: neither is
# useful without the other. Include the requesting user so an authorization
# decision made for one account is never reused for another.
_credential_cache: dict[tuple[str, str], SpaceCredential] = {}


def forget_credential(did: str, space: str) -> None:
    """drop the cached credential plyr holds for ``did`` on ``space``, if any."""
    _credential_cache.pop((did, space), None)


# the requester's own PDS answering that it cannot or will not delegate for this
# space: no spaces support, no covering grant, or a refused request. anything
# else (network, 5xx) is a real failure and propagates.
_DELEGATION_REFUSALS = (
    "MethodNotImplemented",
    "XRPCNotSupported",
    "InsufficientScope",
    "InvalidRequest",
    "AuthMissing",
    "failed: 401",
    "failed: 403",
    "failed: 404",
)


async def _mint_credential(auth_session: AuthSession, space: str) -> SpaceCredential:
    try:
        delegation_resp = await make_pds_request(
            auth_session,
            "GET",
            "com.atproto.space.getDelegationToken",
            params={"space": space},
        )
    except Exception as exc:
        if any(marker in str(exc) for marker in _DELEGATION_REFUSALS):
            raise SpaceAccessError(
                f"requester's PDS did not delegate for {space}: {exc}"
            ) from exc
        raise
    delegation_token = delegation_resp["token"]

    authority = parse_space_uri(space).owner_did
    audience = f"{authority}#atproto_space_host"
    payload = {"space": space}
    if attestation := create_space_client_attestation(audience):
        payload["clientAttestation"] = attestation

    # Credential issuance happens on the resolved space host, which may differ
    # from both the user's PDS and each writer's repo host.
    dpop_key = DPoPManager.generate_keypair()
    cred_resp = await _space_token_request(
        await _space_host_url(space),
        "POST",
        "com.atproto.space.getSpaceCredential",
        delegation_token,
        dpop_key,
        issuance=True,
        json=payload,
    )
    if cred_resp.status_code != 200:
        body = cred_resp.text
        # the error names com.atproto.space.getSpaceCredential declares; any 403
        # is a refusal whatever the host calls it
        refused_errors = (
            "SpaceNotFound",
            "SpaceDeleted",
            "UserNotAuthorized",
            "AppNotAuthorized",
            "NotAuthorized",
            "InvalidDelegationToken",
            "InvalidClientAttestation",
        )
        if cred_resp.status_code == 403 or any(e in body for e in refused_errors):
            raise SpaceAccessError(f"space authority refused credential: {body}")
        raise Exception(f"getSpaceCredential failed: {cred_resp.status_code} {body}")
    return SpaceCredential(
        token=cred_resp.json()["credential"],
        dpop_key=dpop_key,
        expires_at=time.monotonic() + _CREDENTIAL_TTL_SECONDS,
    )


async def get_space_credential(
    auth_session: AuthSession, space: str, *, force_refresh: bool = False
) -> SpaceCredential:
    """obtain a space credential for `space`, minting+caching or renewing as needed."""
    now = time.monotonic()
    cache_key = (auth_session.did, space)
    if not force_refresh and (cached := _credential_cache.get(cache_key)):
        if cached.expires_at > now:
            return cached
    credential = await _mint_credential(auth_session, space)
    _credential_cache[cache_key] = credential
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
            headers = _space_dpop_headers(
                "GET", url, credential.token, credential.dpop_key
            )
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
        response = await _space_token_request(
            host_url,
            "GET",
            endpoint,
            credential.token,
            credential.dpop_key,
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
    cursor: str | None = None,
) -> dict[str, Any]:
    """Discover the writer set for a space from its authority host.

    A full page carries ``cursor``; the final page omits it.
    """
    params: dict[str, Any] = {"space": space, "limit": limit}
    if cursor:
        params["cursor"] = cursor
    return await _credential_read(
        auth_session,
        host_url=await _space_host_url(space),
        endpoint="com.atproto.space.listRepos",
        space=space,
        params=params,
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
    since: str | None = None,
    limit: int = 500,
    cursor: str | None = None,
) -> dict[str, Any]:
    """Pull incremental operations directly from a writer's repo host.

    A full page carries ``cursor`` and no ``commit``; the page that reaches the
    head of the oplog carries the signed ``commit`` and no ``cursor``. ``cursor``
    takes precedence over ``since`` when both are sent.
    """
    params: dict[str, Any] = {"space": space, "repo": repo, "limit": limit}
    if since:
        params["since"] = since
    if cursor:
        params["cursor"] = cursor
    return await _credential_read(
        auth_session,
        host_url=await _repo_host_url(repo),
        endpoint="com.atproto.space.listRepoOps",
        space=space,
        params=params,
    )

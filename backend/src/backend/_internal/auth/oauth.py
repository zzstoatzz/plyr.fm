"""OAuth client config, flows, callback, and artist profile."""

import json
import logging
import secrets
import time
from datetime import UTC, datetime

from atproto_oauth import OAuthClient, OAuthState, PromptType
from atproto_oauth.client import (
    discover_authserver_from_pds_async,
    fetch_authserver_metadata_async,
)
from atproto_oauth.dpop import DPoPManager
from atproto_oauth.pkce import PKCEManager
from atproto_oauth.scopes import ScopesSet
from atproto_oauth.stores.memory import MemorySessionStore
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import HTTPException
from jose import jwk
from sqlalchemy import select

from backend._internal.auth.session import (
    _check_copyright_paradigm,
    _check_teal_preference,
    _compute_refresh_token_expires_at,
    get_client_auth_method,
    get_refresh_token_lifetime_days,
)
from backend._internal.oauth_stores import PostgresStateStore
from backend.config import settings
from backend.models import Artist
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

# OAuth stores
# state store: postgres-backed for multi-instance resilience
# session store: in-memory (not used, we use UserSession table instead)
_state_store = PostgresStateStore()
_session_store = MemorySessionStore()

# confidential client key (loaded lazily)
_client_secret_key: EllipticCurvePrivateKey | None = None
_client_secret_kid: str | None = None
_client_secret_key_loaded = False


def _load_client_secret() -> tuple[EllipticCurvePrivateKey | None, str | None]:
    """load EC private key and kid from OAUTH_JWK setting.

    returns (None, None) if OAUTH_JWK is not configured (public client mode).
    """
    global _client_secret_key, _client_secret_kid, _client_secret_key_loaded

    if _client_secret_key_loaded:
        return _client_secret_key, _client_secret_kid

    _client_secret_key_loaded = True

    if not settings.atproto.oauth_jwk:
        logger.info("OAUTH_JWK not configured, using public OAuth client")
        return None, None

    try:
        # parse JWK JSON
        jwk_data = json.loads(settings.atproto.oauth_jwk)

        # extract kid (required for client assertions)
        _client_secret_kid = jwk_data.get("kid")
        if not _client_secret_kid:
            raise ValueError("OAUTH_JWK must include 'kid' field")

        # convert JWK to PEM format using python-jose
        key_obj = jwk.construct(jwk_data, algorithm="ES256")
        pem_bytes = key_obj.to_pem()

        # load as cryptography key
        loaded_key = load_pem_private_key(pem_bytes, password=None)

        if not isinstance(loaded_key, ec.EllipticCurvePrivateKey):
            raise ValueError("OAUTH_JWK must be an EC key (ES256)")

        _client_secret_key = loaded_key
        logger.info(f"loaded confidential OAuth client key (kid={_client_secret_kid})")
        return _client_secret_key, _client_secret_kid

    except Exception as e:
        logger.error(f"failed to load OAUTH_JWK: {e}")
        raise RuntimeError(f"invalid OAUTH_JWK configuration: {e}") from e


def get_public_jwks() -> dict | None:
    """get public JWKS for the /.well-known/jwks.json endpoint.

    returns None if confidential client is not configured.
    """
    if not settings.atproto.oauth_jwk:
        return None

    try:
        # parse private JWK
        jwk_data = json.loads(settings.atproto.oauth_jwk)

        # construct key and extract public components
        key_obj = jwk.construct(jwk_data, algorithm="ES256")
        public_jwk = key_obj.to_dict()

        # remove private key components, keep only public
        public_jwk.pop("d", None)  # private key scalar

        # ensure required fields for public key
        public_jwk["use"] = "sig"
        public_jwk["alg"] = "ES256"

        # preserve kid from original JWK (python-jose's to_dict() doesn't include it)
        if "kid" in jwk_data:
            public_jwk["kid"] = jwk_data["kid"]

        return {"keys": [public_jwk]}

    except Exception as e:
        logger.error(f"failed to generate public JWKS: {e}")
        return None


def get_oauth_client(
    include_teal: bool = False,
    include_indiemusi: bool = False,
    include_permissioned: bool = False,
) -> OAuthClient:
    """create an OAuth client with the appropriate scopes.

    if OAUTH_JWK is configured, creates a confidential client with
    private_key_jwt authentication. otherwise creates a public client.
    """
    scope = settings.atproto.resolved_scope_with_extras(
        teal_play=settings.teal.play_collection if include_teal else None,
        teal_status=settings.teal.status_collection if include_teal else None,
        indiemusi_tokens=(
            settings.indiemusi.scope_tokens() if include_indiemusi else None
        ),
        permissioned_spaces=include_permissioned,
    )

    # load confidential client key if configured
    client_secret_key, client_secret_kid = _load_client_secret()

    return OAuthClient(
        client_id=settings.atproto.client_id,
        redirect_uri=settings.atproto.redirect_uri,
        scope=scope,
        state_store=_state_store,
        session_store=_session_store,
        client_secret_key=client_secret_key,
        client_secret_kid=client_secret_kid,
    )


def get_oauth_client_for_scope(scope: str) -> OAuthClient:
    """get an OAuth client matching a given scope string.

    used during callback to match the scope that was used during authorization.
    """
    scopes = ScopesSet.from_string(scope)
    include_teal = scopes.matches(
        "repo", collection=settings.teal.play_collection, action="create"
    )
    include_indiemusi = scopes.matches(
        "repo", collection=settings.indiemusi.song_collection, action="create"
    )
    # match on the private-media NSID — present whether the scope is the requested
    # `include:<nsid>` form or the granted, expanded `space:<nsid>?...` form
    include_permissioned = settings.atproto.private_media_space_type in scope
    return get_oauth_client(
        include_teal=include_teal,
        include_indiemusi=include_indiemusi,
        include_permissioned=include_permissioned,
    )


def _bsky_edge_block_error(exc: Exception, handle: str) -> HTTPException | None:
    """detect the bsky.social edge-block failure mode and surface a clear message.

    bluesky-social/atproto#4764 — bsky.social's edge has been observed returning
    403 to httpx-shaped requests from cloud egress, breaking handle resolution
    and OAuth metadata fetches for `*.bsky.social` users. when that happens the
    SDK surfaces a stack-trace flavored `Failed to resolve handle` error that
    looks like a plyr.fm bug; this rewrites it to make the upstream cause clear.
    """
    msg = str(exc)
    is_bsky_handle = handle.endswith(".bsky.social")
    looks_like_edge_block = ("403 Forbidden" in msg and "bsky.social" in msg) or (
        is_bsky_handle and "Failed to resolve handle" in msg
    )
    if not looks_like_edge_block:
        return None
    return HTTPException(
        status_code=503,
        detail=(
            "Bluesky's servers are currently blocking sign-in requests from our "
            "backend. This is a temporary upstream issue on Bluesky's side, not "
            "an account problem — please try again in a few minutes. Tracking: "
            "https://github.com/bluesky-social/atproto/issues/4764"
        ),
    )


async def start_oauth_flow(
    handle: str, prompt: PromptType | None = None
) -> tuple[str, str]:
    """start OAuth flow and return (auth_url, state).

    uses extended scope if user has enabled teal.fm scrobbling or has opted
    into a copyright paradigm.
    """
    from backend._internal.atproto.handles import resolve_handle

    try:
        # resolve handle to DID to check preferences (best-effort: the OAuth flow
        # resolves the handle again internally if this fails)
        wants_teal = wants_indiemusi = False
        if resolved := await resolve_handle(handle):
            did = resolved["did"]
            wants_teal = await _check_teal_preference(did)
            wants_indiemusi = await _check_copyright_paradigm(did)

        # request the private-media space scope by default. capability can't be
        # probed before the scope is granted (a scopeless space call just 401s), so
        # OAuth itself is the discovery: a PDS that can't resolve the permission set
        # rejects PAR with `invalid_scope`, and we retry without it (that account
        # simply won't see private media). a capable PDS grants it up front, so the
        # granted scope becomes the capability signal — see spaces.capability.
        try:
            auth_url, state = await get_oauth_client(
                include_teal=wants_teal,
                include_indiemusi=wants_indiemusi,
                include_permissioned=True,
            ).start_authorization(handle, prompt=prompt)
            logger.info(
                f"starting OAuth for {handle} "
                f"(teal={wants_teal}, indiemusi={wants_indiemusi}, permissioned=True)"
            )
            return auth_url, state
        except Exception as e:
            if "invalid_scope" not in str(e):
                raise
            logger.info(
                f"{handle}'s PDS rejected the private-media scope (invalid_scope); "
                f"retrying login without it"
            )
            auth_url, state = await get_oauth_client(
                include_teal=wants_teal,
                include_indiemusi=wants_indiemusi,
                include_permissioned=False,
            ).start_authorization(handle, prompt=prompt)
            return auth_url, state
    except HTTPException:
        raise
    except Exception as e:
        if friendly := _bsky_edge_block_error(e, handle):
            raise friendly from e
        raise HTTPException(
            status_code=400,
            detail=f"failed to start OAuth flow: {e}",
        ) from e


async def start_oauth_flow_with_scopes(
    handle: str,
    include_teal: bool = False,
    include_indiemusi: bool = False,
    include_permissioned: bool = False,
    prompt: PromptType | None = None,
) -> tuple[str, str]:
    """start OAuth flow with explicit scope selection (used for scope upgrades)."""
    try:
        client = get_oauth_client(
            include_teal=include_teal,
            include_indiemusi=include_indiemusi,
            include_permissioned=include_permissioned,
        )
        logger.info(
            f"starting scope upgrade OAuth for {handle} "
            f"(teal={include_teal}, indiemusi={include_indiemusi}, "
            f"permissioned={include_permissioned})"
        )
        auth_url, state = await client.start_authorization(handle, prompt=prompt)
        return auth_url, state
    except HTTPException:
        raise
    except Exception as e:
        if friendly := _bsky_edge_block_error(e, handle):
            raise friendly from e
        raise HTTPException(
            status_code=400,
            detail=f"failed to start OAuth flow: {e}",
        ) from e


async def start_oauth_flow_for_pds(pds_url: str) -> tuple[str, str]:
    """start OAuth flow for account creation on a PDS.

    discovers auth server from PDS URL and sends PAR with prompt=create.
    """
    from urllib.parse import urlencode

    import httpx

    try:
        pds_url = pds_url.rstrip("/")

        # discover auth server from PDS
        authserver_url = await discover_authserver_from_pds_async(pds_url)
        authserver_url = authserver_url.rstrip("/")

        # fetch auth server metadata
        authserver_meta = await fetch_authserver_metadata_async(authserver_url)

        # get OAuth client for scope/keys
        client = get_oauth_client(include_teal=False)

        # generate PKCE and DPoP
        pkce = PKCEManager()
        pkce_verifier, pkce_challenge = pkce.generate_pair()
        dpop = DPoPManager()
        dpop_key = dpop.generate_keypair()
        state_token = secrets.token_urlsafe(32)

        # build PAR request with prompt=create and no login_hint
        par_url = authserver_meta.pushed_authorization_request_endpoint
        params: dict[str, str] = {
            "response_type": "code",
            "code_challenge": pkce_challenge,
            "code_challenge_method": "S256",
            "state": state_token,
            "redirect_uri": client.redirect_uri,
            "scope": client.scope,
            "client_id": client.client_id,
            "prompt": "create",
        }

        # add client authentication if confidential client
        client_secret_key, client_secret_kid = _load_client_secret()
        if client_secret_key and client_secret_kid:
            client_assertion = _create_client_assertion(
                client.client_id,
                authserver_meta.issuer,
                client_secret_key,
                client_secret_kid,
            )
            params["client_assertion_type"] = (
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
            )
            params["client_assertion"] = client_assertion

        # make PAR request with DPoP nonce retry
        dpop_nonce = ""
        for attempt in range(2):
            dpop_proof = dpop.create_proof(
                method="POST",
                url=par_url,
                private_key=dpop_key,
                nonce=dpop_nonce if dpop_nonce else None,
            )

            async with httpx.AsyncClient() as http:
                response = await http.post(
                    par_url, data=params, headers={"DPoP": dpop_proof}
                )

            if dpop.is_dpop_nonce_error(response):
                new_nonce = dpop.extract_nonce_from_response(response)
                if new_nonce and attempt == 0:
                    dpop_nonce = new_nonce
                    continue

            dpop_nonce = dpop.extract_nonce_from_response(response) or dpop_nonce
            break

        if response.status_code not in (200, 201):
            raise HTTPException(
                status_code=400,
                detail=f"PAR request failed: {response.status_code} {response.text}",
            )

        par_response = response.json()
        request_uri = par_response["request_uri"]

        # store state with did=None (unknown until account created)
        oauth_state = OAuthState(
            state=state_token,
            pkce_verifier=pkce_verifier,
            redirect_uri=client.redirect_uri,
            scope=client.scope,
            authserver_iss=authserver_meta.issuer,
            dpop_private_key=dpop_key,
            dpop_authserver_nonce=dpop_nonce,
            did=None,
            handle=None,
            pds_url=pds_url,
        )
        await _state_store.save_state(oauth_state)

        # build authorization URL
        auth_params = {"client_id": client.client_id, "request_uri": request_uri}
        auth_url = f"{authserver_meta.authorization_endpoint}?{urlencode(auth_params)}"

        logger.info(f"starting account creation OAuth for PDS {pds_url}")
        return auth_url, state_token

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(
            status_code=400,
            detail=f"failed to start account creation OAuth: {e}",
        ) from e


def _create_client_assertion(
    client_id: str,
    audience: str,
    private_key: EllipticCurvePrivateKey,
    kid: str,
) -> str:
    """create client assertion JWT for confidential client."""
    header = {"alg": "ES256", "typ": "JWT", "kid": kid}
    now = int(time.time())
    payload = {
        "iss": client_id,
        "sub": client_id,
        "aud": audience,
        "jti": secrets.token_urlsafe(16),
        "iat": now,
        "exp": now + 60,
    }

    dpop = DPoPManager()
    return dpop._sign_jwt(header, payload, private_key)


async def _resolve_handle_from_pds(pds_url: str, did: str) -> str | None:
    """resolve handle from PDS when OAuth doesn't return it.

    this happens for newly created accounts on third-party PDSes where
    the handle isn't yet indexed by the Bluesky AppView.
    """
    import httpx

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{pds_url}/xrpc/com.atproto.repo.describeRepo",
                params={"repo": did},
                timeout=10.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                handle = data.get("handle")
                if handle:
                    logger.info(f"resolved handle from PDS: {handle}")
                    return handle
    except Exception as e:
        logger.warning(f"failed to resolve handle from PDS: {e}")
    return None


async def handle_oauth_callback(
    code: str, state: str, iss: str
) -> tuple[str, str, dict]:
    """handle OAuth callback and return (did, handle, oauth_session).

    uses the appropriate OAuth client based on stored state's scope.
    """
    try:
        # look up stored state to determine which scope was used
        if stored_state := await _state_store.get_state(state):
            client = get_oauth_client_for_scope(stored_state.scope)
            logger.info(
                f"callback using client for scope: {stored_state.scope[:50]}..."
            )
        else:
            # fallback to base client (state might have been cleaned up)
            client = get_oauth_client(include_teal=False)
            logger.warning(f"state {state[:8]}... not found, using base client")

        oauth_session = await client.handle_callback(
            code=code,
            state=state,
            iss=iss,
        )

        # resolve handle from PDS if not provided by OAuth
        # (happens for newly created accounts on third-party PDSes)
        handle = oauth_session.handle
        if not handle:
            handle = (
                await _resolve_handle_from_pds(oauth_session.pds_url, oauth_session.did)
                or ""
            )

        # serialize DPoP private key for storage
        from cryptography.hazmat.primitives import serialization

        dpop_key_pem = oauth_session.dpop_private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        client_auth_method = get_client_auth_method()
        refresh_lifetime_days = get_refresh_token_lifetime_days(client_auth_method)
        refresh_expires_at = _compute_refresh_token_expires_at(
            datetime.now(UTC), client_auth_method
        )

        # store full OAuth session with tokens in database
        session_data = {
            "did": oauth_session.did,
            "handle": handle,
            "pds_url": oauth_session.pds_url,
            "authserver_iss": oauth_session.authserver_iss,
            "scope": oauth_session.scope,
            "access_token": oauth_session.access_token,
            "refresh_token": oauth_session.refresh_token,
            "dpop_private_key_pem": dpop_key_pem,
            "dpop_authserver_nonce": oauth_session.dpop_authserver_nonce,
            "dpop_pds_nonce": oauth_session.dpop_pds_nonce or "",
            "client_auth_method": client_auth_method,
            "refresh_token_lifetime_days": refresh_lifetime_days,
            "refresh_token_expires_at": refresh_expires_at.isoformat(),
        }
        return oauth_session.did, handle, session_data
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"OAuth callback failed: {e}",
        ) from e


async def check_artist_profile_exists(did: str) -> bool:
    """check if artist profile exists for a DID."""
    async with db_session() as db:
        result = await db.execute(select(Artist).where(Artist.did == did))
        artist = result.scalar_one_or_none()
        return artist is not None


async def ensure_artist_exists(did: str, handle: str) -> bool:
    """ensure an Artist record exists for the given DID, creating one if needed.

    returns True if artist was created, False if it already existed.
    """
    from backend._internal.atproto.profile import fetch_user_avatar

    async with db_session() as db:
        result = await db.execute(select(Artist).where(Artist.did == did))
        if result.scalar_one_or_none():
            return False  # already exists

        # fetch avatar from Bluesky
        avatar_url = await fetch_user_avatar(did)

        # create minimal artist record
        artist = Artist(
            did=did,
            handle=handle,
            display_name=handle,  # use handle as initial display name
            avatar_url=avatar_url,
        )
        db.add(artist)
        await db.commit()
        logger.info(f"created minimal artist record for {did} (@{handle})")
        return True

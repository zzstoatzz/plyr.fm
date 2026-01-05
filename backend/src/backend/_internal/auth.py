"""OAuth 2.1 authentication and session management."""

import json
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from atproto_oauth import OAuthClient, PromptType
from atproto_oauth.stores.memory import MemorySessionStore
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import Cookie, Header, HTTPException
from jose import jwk
from sqlalchemy import select

from backend._internal.oauth_stores import PostgresStateStore
from backend.config import settings
from backend.models import ExchangeToken, PendingDevToken, UserPreferences, UserSession
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


def _parse_scopes(scope_string: str) -> set[str]:
    """parse an OAuth scope string into a set of individual scopes.

    handles format like: "atproto repo:fm.plyr.track repo:fm.plyr.like"
    returns: {"repo:fm.plyr.track", "repo:fm.plyr.like"}
    """
    parts = scope_string.split()
    # filter out the "atproto" prefix and keep just the repo: scopes
    return {p for p in parts if p.startswith("repo:")}


def _check_scope_coverage(granted_scope: str, required_scope: str) -> bool:
    """check if granted scope covers all required scopes.

    returns True if the session has all required permissions.
    """
    granted = _parse_scopes(granted_scope)
    required = _parse_scopes(required_scope)
    return required.issubset(granted)


def _get_missing_scopes(granted_scope: str, required_scope: str) -> set[str]:
    """get the scopes that are required but not granted."""
    granted = _parse_scopes(granted_scope)
    required = _parse_scopes(required_scope)
    return required - granted


@dataclass
class Session:
    """authenticated user session."""

    session_id: str
    did: str
    handle: str
    oauth_session: dict  # store OAuth session data

    def get_oauth_session_id(self) -> str:
        """extract OAuth session ID for retrieving from session store."""
        return self.oauth_session.get("session_id", self.did)


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
    """load EC private key and kid from OAUTH_JWK setting for confidential client.

    the key is expected to be a JSON-serialized JWK with ES256 (P-256) key.
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
        _client_secret_key = load_pem_private_key(pem_bytes, password=None)

        if not isinstance(_client_secret_key, ec.EllipticCurvePrivateKey):
            raise ValueError("OAUTH_JWK must be an EC key (ES256)")

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


def is_confidential_client() -> bool:
    """check if confidential OAuth client is configured."""
    return bool(settings.atproto.oauth_jwk)


def get_oauth_client(include_teal: bool = False) -> OAuthClient:
    """create an OAuth client with the appropriate scopes.

    at ~17 OAuth flows/day, instantiation cost is negligible.
    this eliminates the need for pre-instantiated bifurcated clients.

    if OAUTH_JWK is configured, creates a confidential client with
    private_key_jwt authentication (180-day refresh tokens).
    otherwise creates a public client (2-week refresh tokens).
    """
    scope = (
        settings.atproto.resolved_scope_with_teal(
            settings.teal.play_collection, settings.teal.status_collection
        )
        if include_teal
        else settings.atproto.resolved_scope
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
    include_teal = settings.teal.play_collection in scope
    return get_oauth_client(include_teal=include_teal)


# encryption for sensitive OAuth data at rest
# CRITICAL: encryption key must be configured and stable across restarts
# otherwise all sessions become undecipherable after restart
if not settings.atproto.oauth_encryption_key:
    raise RuntimeError(
        "oauth_encryption_key must be configured in settings. "
        "generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
    )

_encryption_key = settings.atproto.oauth_encryption_key.encode()
_fernet = Fernet(_encryption_key)


def _encrypt_data(data: str) -> str:
    """encrypt sensitive data for storage."""
    return _fernet.encrypt(data.encode()).decode()


def _decrypt_data(encrypted: str) -> str | None:
    """decrypt sensitive data from storage.

    returns None if decryption fails (e.g., key changed, data corrupted).
    """
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except Exception:
        # decryption failed - likely key mismatch or corrupted data
        return None


async def create_session(
    did: str,
    handle: str,
    oauth_session: dict[str, Any],
    expires_in_days: int = 14,
    is_developer_token: bool = False,
    token_name: str | None = None,
    group_id: str | None = None,
) -> str:
    """create a new session for authenticated user with encrypted OAuth data.

    args:
        did: user's decentralized identifier
        handle: user's ATProto handle
        oauth_session: OAuth session data to encrypt and store
        expires_in_days: session expiration in days (default 14, use 0 for no expiration)
        is_developer_token: whether this is a developer token (for listing/revocation)
        token_name: optional name for the token (only for developer tokens)
        group_id: optional session group ID for multi-account support
    """
    session_id = secrets.token_urlsafe(32)

    encrypted_data = _encrypt_data(json.dumps(oauth_session))

    expires_at = (
        datetime.now(UTC) + timedelta(days=expires_in_days)
        if expires_in_days > 0
        else None
    )

    async with db_session() as db:
        user_session = UserSession(
            session_id=session_id,
            did=did,
            handle=handle,
            oauth_session_data=encrypted_data,
            expires_at=expires_at,
            is_developer_token=is_developer_token,
            token_name=token_name,
            group_id=group_id,
        )
        db.add(user_session)
        await db.commit()

    return session_id


async def get_session(session_id: str) -> Session | None:
    """retrieve session by id, decrypt OAuth data, and validate expiration."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        if not (user_session := result.scalar_one_or_none()):
            return None

        # check if session is expired
        if user_session.expires_at and datetime.now(UTC) > user_session.expires_at:
            # session expired - delete it and return None
            await delete_session(session_id)
            return None

        # decrypt OAuth session data
        decrypted_data = _decrypt_data(user_session.oauth_session_data)
        if decrypted_data is None:
            # decryption failed - session is invalid (key changed or data corrupted)
            # delete the corrupted session
            await delete_session(session_id)
            return None

        return Session(
            session_id=user_session.session_id,
            did=user_session.did,
            handle=user_session.handle,
            oauth_session=json.loads(decrypted_data),
        )


async def update_session_tokens(
    session_id: str, oauth_session_data: dict[str, Any]
) -> None:
    """update OAuth session data for a session (e.g., after token refresh)."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        if user_session := result.scalar_one_or_none():
            # encrypt updated OAuth session data
            encrypted_data = _encrypt_data(json.dumps(oauth_session_data))
            user_session.oauth_session_data = encrypted_data
            await db.commit()


async def delete_session(session_id: str) -> None:
    """delete a session."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        if user_session := result.scalar_one_or_none():
            await db.delete(user_session)
            await db.commit()


async def _check_teal_preference(did: str) -> bool:
    """check if user has enabled teal.fm scrobbling."""
    async with db_session() as db:
        result = await db.execute(
            select(UserPreferences.enable_teal_scrobbling).where(
                UserPreferences.did == did
            )
        )
        pref = result.scalar_one_or_none()
        return pref is True


async def start_oauth_flow(
    handle: str, prompt: PromptType | None = None
) -> tuple[str, str]:
    """start OAuth flow and return (auth_url, state).

    uses extended scope if user has enabled teal.fm scrobbling.

    args:
        handle: user's ATProto handle
        prompt: optional OAuth prompt parameter (login, select_account, consent, none)
    """
    from backend._internal.atproto.handles import resolve_handle

    try:
        # resolve handle to DID to check preferences
        resolved = await resolve_handle(handle)
        if resolved:
            did = resolved["did"]
            wants_teal = await _check_teal_preference(did)
            client = get_oauth_client(include_teal=wants_teal)
            logger.info(f"starting OAuth for {handle} (did={did}, teal={wants_teal})")
        else:
            # fallback to base client if resolution fails
            # (OAuth flow will resolve handle again internally)
            client = get_oauth_client(include_teal=False)
            logger.info(f"starting OAuth for {handle} (resolution failed, using base)")

        auth_url, state = await client.start_authorization(handle, prompt=prompt)
        return auth_url, state
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"failed to start OAuth flow: {e}",
        ) from e


async def start_oauth_flow_with_scopes(
    handle: str, include_teal: bool, prompt: PromptType | None = None
) -> tuple[str, str]:
    """start OAuth flow with explicit scope selection.

    unlike start_oauth_flow which checks user preferences, this explicitly
    requests the specified scopes. used for scope upgrade flows.

    args:
        handle: user's ATProto handle
        include_teal: whether to include teal.fm scopes
        prompt: optional OAuth prompt parameter (login, select_account, consent, none)
    """
    try:
        client = get_oauth_client(include_teal=include_teal)
        logger.info(f"starting scope upgrade OAuth for {handle} (teal={include_teal})")
        auth_url, state = await client.start_authorization(handle, prompt=prompt)
        return auth_url, state
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"failed to start OAuth flow: {e}",
        ) from e


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

        # serialize DPoP private key for storage
        from cryptography.hazmat.primitives import serialization

        dpop_key_pem = oauth_session.dpop_private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        # store full OAuth session with tokens in database
        session_data = {
            "did": oauth_session.did,
            "handle": oauth_session.handle,
            "pds_url": oauth_session.pds_url,
            "authserver_iss": oauth_session.authserver_iss,
            "scope": oauth_session.scope,
            "access_token": oauth_session.access_token,
            "refresh_token": oauth_session.refresh_token,
            "dpop_private_key_pem": dpop_key_pem,
            "dpop_authserver_nonce": oauth_session.dpop_authserver_nonce,
            "dpop_pds_nonce": oauth_session.dpop_pds_nonce or "",
        }
        return oauth_session.did, oauth_session.handle, session_data
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"OAuth callback failed: {e}",
        ) from e


async def check_artist_profile_exists(did: str) -> bool:
    """check if artist profile exists for a DID."""
    from backend.models import Artist

    async with db_session() as db:
        result = await db.execute(select(Artist).where(Artist.did == did))
        artist = result.scalar_one_or_none()
        return artist is not None


async def create_exchange_token(session_id: str, is_dev_token: bool = False) -> str:
    """create a one-time use exchange token for secure OAuth callback.

    exchange tokens expire after 60 seconds and can only be used once,
    preventing session_id exposure in browser history/referrers.

    args:
        session_id: the session to associate with this exchange token
        is_dev_token: if True, the exchange will not set a browser cookie
    """
    token = secrets.token_urlsafe(32)

    async with db_session() as db:
        exchange_token = ExchangeToken(
            token=token,
            session_id=session_id,
            is_dev_token=is_dev_token,
        )
        db.add(exchange_token)
        await db.commit()

    return token


async def consume_exchange_token(token: str) -> tuple[str, bool] | None:
    """consume an exchange token and return (session_id, is_dev_token).

    returns None if token is invalid, expired, or already used.
    uses atomic UPDATE to prevent race conditions (token can only be used once).
    """
    from sqlalchemy import update

    async with db_session() as db:
        # first, check if token exists and is not expired
        result = await db.execute(
            select(ExchangeToken).where(ExchangeToken.token == token)
        )
        exchange_token = result.scalar_one_or_none()

        if not exchange_token:
            return None

        # check if expired
        if datetime.now(UTC) > exchange_token.expires_at:
            return None

        # capture is_dev_token before atomic update
        is_dev_token = exchange_token.is_dev_token

        # atomically mark as used ONLY if not already used
        # this prevents race conditions where two requests try to use the same token
        result = await db.execute(
            update(ExchangeToken)
            .where(ExchangeToken.token == token, ExchangeToken.used == False)  # noqa: E712
            .values(used=True)
            .returning(ExchangeToken.session_id)
        )
        await db.commit()

        # if no rows were updated, token was already used
        session_id = result.scalar_one_or_none()
        if session_id is None:
            return None

        return session_id, is_dev_token


async def require_auth(
    authorization: Annotated[str | None, Header()] = None,
    session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> Session:
    """fastapi dependency to require authentication with expiration validation.

    checks cookie first (for browser requests), then falls back to Authorization
    header (for SDK/CLI clients). this enables secure HttpOnly cookies for browsers
    while maintaining bearer token support for API clients.

    also validates that the session's granted scopes cover all currently required
    scopes. if not, returns 403 with "scope_upgrade_required" to prompt re-login.
    """
    session_id_value = None

    if session_id:
        session_id_value = session_id
    elif authorization and authorization.startswith("Bearer "):
        session_id_value = authorization.removeprefix("Bearer ")

    if not session_id_value:
        raise HTTPException(
            status_code=401,
            detail="not authenticated - login required",
        )

    session = await get_session(session_id_value)
    if not session:
        raise HTTPException(
            status_code=401,
            detail="invalid or expired session",
        )

    # check if session has all required scopes
    granted_scope = session.oauth_session.get("scope", "")
    required_scope = settings.atproto.resolved_scope

    if not _check_scope_coverage(granted_scope, required_scope):
        missing = _get_missing_scopes(granted_scope, required_scope)
        logger.info(
            f"session {session.did} missing scopes: {missing}, prompting re-auth"
        )
        raise HTTPException(
            status_code=403,
            detail="scope_upgrade_required",
        )

    return session


async def get_optional_session(
    authorization: Annotated[str | None, Header()] = None,
    session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> Session | None:
    """fastapi dependency to optionally get the current session.

    returns None if not authenticated, otherwise returns the session.
    useful for public endpoints that show additional info for logged-in users.
    """
    session_id_value = None

    if session_id:
        session_id_value = session_id
    elif authorization and authorization.startswith("Bearer "):
        session_id_value = authorization.removeprefix("Bearer ")

    if not session_id_value:
        return None

    return await get_session(session_id_value)


async def require_artist_profile(
    authorization: Annotated[str | None, Header()] = None,
    session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> Session:
    """fastapi dependency to require authentication AND complete artist profile.

    Returns 403 with specific message if artist profile doesn't exist,
    prompting frontend to redirect to profile setup.
    """
    session = await require_auth(authorization, session_id)

    # check if artist profile exists
    if not await check_artist_profile_exists(session.did):
        raise HTTPException(
            status_code=403,
            detail="artist_profile_required",
        )

    return session


@dataclass
class DeveloperToken:
    """developer token metadata (without sensitive session data)."""

    session_id: str
    token_name: str | None
    created_at: datetime
    expires_at: datetime | None


async def list_developer_tokens(did: str) -> list[DeveloperToken]:
    """list all developer tokens for a user."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(
                UserSession.did == did,
                UserSession.is_developer_token == True,  # noqa: E712
            )
        )
        sessions = result.scalars().all()

        tokens = []
        for session in sessions:
            # check if expired
            if session.expires_at and datetime.now(UTC) > session.expires_at:
                continue  # skip expired tokens

            tokens.append(
                DeveloperToken(
                    session_id=session.session_id,
                    token_name=session.token_name,
                    created_at=session.created_at,
                    expires_at=session.expires_at,
                )
            )

        return tokens


async def revoke_developer_token(did: str, session_id: str) -> bool:
    """revoke a developer token. returns True if successful, False if not found."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(
                UserSession.session_id == session_id,
                UserSession.did == did,  # ensure user owns this token
                UserSession.is_developer_token == True,  # noqa: E712
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            return False

        await db.delete(session)
        await db.commit()
        return True


@dataclass
class PendingDevTokenData:
    """metadata for a pending developer token OAuth flow."""

    state: str
    did: str
    token_name: str | None
    expires_in_days: int


async def save_pending_dev_token(
    state: str,
    did: str,
    token_name: str | None,
    expires_in_days: int,
) -> None:
    """save pending dev token metadata keyed by OAuth state."""
    async with db_session() as db:
        pending = PendingDevToken(
            state=state,
            did=did,
            token_name=token_name,
            expires_in_days=expires_in_days,
        )
        db.add(pending)
        await db.commit()


async def get_pending_dev_token(state: str) -> PendingDevTokenData | None:
    """get pending dev token metadata by OAuth state."""
    async with db_session() as db:
        result = await db.execute(
            select(PendingDevToken).where(PendingDevToken.state == state)
        )
        pending = result.scalar_one_or_none()

        if not pending:
            return None

        # check if expired
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None

        return PendingDevTokenData(
            state=pending.state,
            did=pending.did,
            token_name=pending.token_name,
            expires_in_days=pending.expires_in_days,
        )


async def delete_pending_dev_token(state: str) -> None:
    """delete pending dev token metadata after use."""
    async with db_session() as db:
        result = await db.execute(
            select(PendingDevToken).where(PendingDevToken.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()


# scope upgrade flow helpers


@dataclass
class PendingScopeUpgradeData:
    """metadata for a pending scope upgrade OAuth flow."""

    state: str
    did: str
    old_session_id: str
    requested_scopes: str


async def save_pending_scope_upgrade(
    state: str,
    did: str,
    old_session_id: str,
    requested_scopes: str,
) -> None:
    """save pending scope upgrade metadata keyed by OAuth state."""
    from backend.models import PendingScopeUpgrade

    async with db_session() as db:
        pending = PendingScopeUpgrade(
            state=state,
            did=did,
            old_session_id=old_session_id,
            requested_scopes=requested_scopes,
        )
        db.add(pending)
        await db.commit()


async def get_pending_scope_upgrade(state: str) -> PendingScopeUpgradeData | None:
    """get pending scope upgrade metadata by OAuth state."""
    from backend.models import PendingScopeUpgrade

    async with db_session() as db:
        result = await db.execute(
            select(PendingScopeUpgrade).where(PendingScopeUpgrade.state == state)
        )
        pending = result.scalar_one_or_none()

        if not pending:
            return None

        # check if expired
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None

        return PendingScopeUpgradeData(
            state=pending.state,
            did=pending.did,
            old_session_id=pending.old_session_id,
            requested_scopes=pending.requested_scopes,
        )


async def delete_pending_scope_upgrade(state: str) -> None:
    """delete pending scope upgrade metadata after use."""
    from backend.models import PendingScopeUpgrade

    async with db_session() as db:
        result = await db.execute(
            select(PendingScopeUpgrade).where(PendingScopeUpgrade.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()


# multi-account session group helpers


@dataclass
class LinkedAccount:
    """account info for account switcher UI."""

    did: str
    handle: str
    session_id: str


async def get_session_group(session_id: str) -> list[LinkedAccount]:
    """get all accounts in the same session group.

    returns empty list if session has no group_id (single account).
    """
    async with db_session() as db:
        result = await db.execute(
            select(UserSession.group_id).where(UserSession.session_id == session_id)
        )
        group_id = result.scalar_one_or_none()

        if not group_id:
            return []

        result = await db.execute(
            select(UserSession).where(
                UserSession.group_id == group_id,
                UserSession.is_developer_token == False,  # noqa: E712
            )
        )
        sessions = result.scalars().all()

        accounts = []
        for session in sessions:
            if session.expires_at and datetime.now(UTC) > session.expires_at:
                continue

            accounts.append(
                LinkedAccount(
                    did=session.did,
                    handle=session.handle,
                    session_id=session.session_id,
                )
            )

        return accounts


async def get_or_create_group_id(session_id: str) -> str:
    """get existing group_id or create one for this session.

    used when adding a second account to create a group.
    """
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(status_code=404, detail="session not found")

        if session.group_id:
            return session.group_id

        # create new group_id for this session
        group_id = secrets.token_urlsafe(32)
        session.group_id = group_id
        await db.commit()

        return group_id


async def switch_active_account(current_session_id: str, target_session_id: str) -> str:
    """switch to a different account within a session group.

    validates that the target session exists, is in the same group, and isn't expired.
    returns the target session_id (caller updates the cookie).
    """
    async with db_session() as db:
        # get current session to find group_id
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == current_session_id)
        )
        current_session = result.scalar_one_or_none()

        if not current_session or not current_session.group_id:
            raise HTTPException(status_code=400, detail="no session group found")

        # verify target session is in the same group
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == target_session_id)
        )
        target_session = result.scalar_one_or_none()

        if not target_session:
            raise HTTPException(status_code=404, detail="target session not found")

        if target_session.group_id != current_session.group_id:
            raise HTTPException(
                status_code=403, detail="target session not in same group"
            )

        # check if target session is expired
        if target_session.expires_at and datetime.now(UTC) > target_session.expires_at:
            raise HTTPException(status_code=401, detail="target session expired")

        return target_session_id


async def remove_account_from_group(session_id: str) -> str | None:
    """remove a session from its group and delete it.

    returns session_id of another account in the group, or None if last account.
    """
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            return None

        group_id = session.group_id

        await db.delete(session)
        await db.commit()

        if not group_id:
            return None

        result = await db.execute(
            select(UserSession).where(
                UserSession.group_id == group_id,
                UserSession.is_developer_token == False,  # noqa: E712
            )
        )
        remaining = result.scalars().first()

        return remaining.session_id if remaining else None


# pending add account flow helpers


@dataclass
class PendingAddAccountData:
    """metadata for a pending add-account OAuth flow."""

    state: str
    group_id: str


async def save_pending_add_account(state: str, group_id: str) -> None:
    """save pending add-account metadata keyed by OAuth state."""
    from backend.models import PendingAddAccount

    async with db_session() as db:
        pending = PendingAddAccount(
            state=state,
            group_id=group_id,
        )
        db.add(pending)
        await db.commit()


async def get_pending_add_account(state: str) -> PendingAddAccountData | None:
    """get pending add-account metadata by OAuth state."""
    from backend.models import PendingAddAccount

    async with db_session() as db:
        result = await db.execute(
            select(PendingAddAccount).where(PendingAddAccount.state == state)
        )
        pending = result.scalar_one_or_none()

        if not pending:
            return None

        # check if expired
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None

        return PendingAddAccountData(
            state=pending.state,
            group_id=pending.group_id,
        )


async def delete_pending_add_account(state: str) -> None:
    """delete pending add-account metadata after use."""
    from backend.models import PendingAddAccount

    async with db_session() as db:
        result = await db.execute(
            select(PendingAddAccount).where(PendingAddAccount.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()

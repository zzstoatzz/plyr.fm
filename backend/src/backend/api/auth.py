"""authentication api endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from starlette.responses import Response

from backend._internal import (
    Session,
    check_artist_profile_exists,
    consume_exchange_token,
    create_exchange_token,
    create_session,
    delete_pending_add_account,
    delete_pending_dev_token,
    delete_pending_scope_upgrade,
    delete_session,
    ensure_artist_exists,
    get_or_create_group_id,
    get_pending_add_account,
    get_pending_dev_token,
    get_pending_scope_upgrade,
    get_session_group,
    handle_oauth_callback,
    list_developer_tokens,
    require_auth,
    revoke_developer_token,
    save_pending_add_account,
    save_pending_dev_token,
    save_pending_scope_upgrade,
    start_oauth_flow,
    start_oauth_flow_with_scopes,
    switch_active_account,
)
from backend._internal.auth import get_refresh_token_lifetime_days
from backend._internal.background_tasks import schedule_atproto_sync
from backend.config import settings
from backend.models import Artist, get_db
from backend.utilities.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class LinkedAccountResponse(BaseModel):
    """account info for account switcher UI."""

    did: str
    handle: str
    avatar_url: str | None


class CurrentUserResponse(BaseModel):
    """response model for current user endpoint."""

    did: str
    handle: str
    linked_accounts: list[LinkedAccountResponse] = []
    enabled_flags: list[str] = []


class DeveloperTokenInfo(BaseModel):
    """info about a developer token (without the actual token)."""

    session_id: str
    name: str | None
    created_at: str  # ISO format
    expires_at: str | None  # ISO format or null for never

    @field_validator("session_id", mode="before")
    @classmethod
    def truncate_session_id(cls, v: str) -> str:
        """truncate to 8-char prefix for safe display."""
        return v[:8] if len(v) > 8 else v


class DeveloperTokenListResponse(BaseModel):
    """response model for listing developer tokens."""

    tokens: list[DeveloperTokenInfo]


@router.get("/start")
@limiter.limit(settings.rate_limit.auth_limit)
async def start_login(request: Request, handle: str) -> RedirectResponse:
    """start OAuth flow for a given handle."""
    auth_url, _state = await start_oauth_flow(handle)
    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def oauth_callback(
    code: Annotated[str, Query()],
    state: Annotated[str, Query()],
    iss: Annotated[str, Query()],
) -> RedirectResponse:
    """handle OAuth callback and create session.

    returns exchange token in URL which frontend will exchange for session_id.
    exchange token is short-lived (60s) and one-time use for security.

    handles four flow types based on pending state:
    1. developer token flow - creates dev token session, redirects with dev_token=true
    2. scope upgrade flow - replaces old session with new one, redirects to settings
    3. add account flow - creates session in existing group, redirects to portal
    4. regular login flow - creates session, redirects to portal or profile setup
    """
    did, handle, oauth_session = await handle_oauth_callback(code, state, iss)

    # ensure Artist record exists for all authenticated users
    # this creates a minimal record if needed, so we can display handles in
    # share link stats, comments, track likers, etc.
    await ensure_artist_exists(did, handle)

    # check if this is a developer token OAuth flow
    pending_dev_token = await get_pending_dev_token(state)

    if pending_dev_token:
        # verify the DID matches (user must be the one who started the flow)
        if pending_dev_token.did != did:
            raise HTTPException(
                status_code=403,
                detail="developer token flow was started by a different user",
            )

        # create dev token session with its own OAuth credentials
        session_id = await create_session(
            did=did,
            handle=handle,
            oauth_session=oauth_session,
            expires_in_days=pending_dev_token.expires_in_days,
            is_developer_token=True,
            token_name=pending_dev_token.token_name,
        )

        # clean up pending record
        await delete_pending_dev_token(state)

        # create exchange token (marked as dev token to prevent cookie override)
        exchange_token = await create_exchange_token(session_id, is_dev_token=True)

        return RedirectResponse(
            url=f"{settings.frontend.url}/settings?exchange_token={exchange_token}&dev_token=true",
            status_code=303,
        )

    # check if this is a scope upgrade OAuth flow
    pending_scope_upgrade = await get_pending_scope_upgrade(state)

    if pending_scope_upgrade:
        # verify the DID matches (user must be the one who started the flow)
        if pending_scope_upgrade.did != did:
            raise HTTPException(
                status_code=403,
                detail="scope upgrade flow was started by a different user",
            )

        # delete the old session
        await delete_session(pending_scope_upgrade.old_session_id)

        # create new session with upgraded scopes
        session_id = await create_session(did, handle, oauth_session)

        # clean up pending record
        await delete_pending_scope_upgrade(state)

        # create exchange token - NOT marked as dev token so cookie gets set
        exchange_token = await create_exchange_token(session_id)

        # schedule ATProto sync (via docket if enabled, else asyncio)
        await schedule_atproto_sync(session_id, did)

        return RedirectResponse(
            url=f"{settings.frontend.url}/settings?exchange_token={exchange_token}&scope_upgraded=true",
            status_code=303,
        )

    # check if this is an add-account OAuth flow
    pending_add_account = await get_pending_add_account(state)

    if pending_add_account:
        # create session linked to the existing group
        session_id = await create_session(
            did=did,
            handle=handle,
            oauth_session=oauth_session,
            group_id=pending_add_account.group_id,
        )

        # clean up pending record
        await delete_pending_add_account(state)

        # create exchange token
        exchange_token = await create_exchange_token(session_id)

        # schedule ATProto sync
        await schedule_atproto_sync(session_id, did)

        return RedirectResponse(
            url=f"{settings.frontend.url}/portal?exchange_token={exchange_token}&account_added=true",
            status_code=303,
        )

    # regular login flow
    session_id = await create_session(did, handle, oauth_session)

    # create one-time exchange token (expires in 60 seconds)
    exchange_token = await create_exchange_token(session_id)

    # check if artist profile exists
    has_profile = await check_artist_profile_exists(did)

    # schedule ATProto sync (via docket if enabled, else asyncio)
    await schedule_atproto_sync(session_id, did)

    # redirect to profile setup if needed, otherwise to portal
    redirect_path = "/portal" if has_profile else "/profile/setup"

    return RedirectResponse(
        url=f"{settings.frontend.url}{redirect_path}?exchange_token={exchange_token}",
        status_code=303,
    )


class ExchangeTokenRequest(BaseModel):
    """request model for exchanging token for session_id."""

    exchange_token: str


class ExchangeTokenResponse(BaseModel):
    """response model for exchange token endpoint."""

    session_id: str


@router.post("/exchange")
@limiter.limit(settings.rate_limit.auth_limit)
async def exchange_token(
    request: Request,
    exchange_request: ExchangeTokenRequest,
    response: Response,
) -> ExchangeTokenResponse:
    """exchange one-time token for session_id.

    frontend calls this immediately after OAuth callback to securely
    exchange the short-lived token for the actual session_id.

    for browser requests: sets HttpOnly cookie and still returns session_id in response
    for SDK/CLI clients: only returns session_id in response (no cookie)
    for dev token exchanges: returns session_id but does NOT set cookie
    """
    result = await consume_exchange_token(exchange_request.exchange_token)

    if not result:
        raise HTTPException(
            status_code=401,
            detail="invalid, expired, or already used exchange token",
        )

    session_id, is_dev_token = result

    # don't set cookie for dev token exchanges - this prevents overwriting
    # the browser's session cookie when creating a dev token
    if is_dev_token:
        return ExchangeTokenResponse(session_id=session_id)

    user_agent = request.headers.get("user-agent", "").lower()
    is_browser = any(
        browser in user_agent
        for browser in ["mozilla", "chrome", "safari", "firefox", "edge", "opera"]
    )

    if is_browser and settings.frontend.url:
        is_localhost = settings.frontend.url.startswith("http://localhost")

        response.set_cookie(
            key="session_id",
            value=session_id,
            httponly=True,
            secure=not is_localhost,  # secure cookies require HTTPS
            samesite="lax",
            max_age=14 * 24 * 60 * 60,
        )

    return ExchangeTokenResponse(session_id=session_id)


@router.post("/logout")
async def logout(
    session: Session = Depends(require_auth),
    switch_to: Annotated[
        str | None, Query(description="DID to switch to after logout")
    ] = None,
    db=Depends(get_db),
) -> JSONResponse:
    """logout current user.

    if switch_to is provided and valid, deletes current session and switches
    to the specified account. otherwise, fully logs out.
    """
    if switch_to:
        # validate target is in same group (reuse db connection)
        linked = await get_session_group(session.session_id, db=db)
        target = next((a for a in linked if a.did == switch_to), None)

        if not target:
            raise HTTPException(
                status_code=400, detail="target account not in session group"
            )

        if target.did == session.did:
            raise HTTPException(
                status_code=400, detail="cannot switch to current account"
            )

        # delete current session
        await delete_session(session.session_id)

        # set cookie to target session
        response = JSONResponse(
            content={"switched_to": {"did": target.did, "handle": target.handle}}
        )

        if settings.frontend.url:
            is_localhost = settings.frontend.url.startswith("http://localhost")
            response.set_cookie(
                key="session_id",
                value=target.session_id,
                httponly=True,
                secure=not is_localhost,
                samesite="lax",
                max_age=14 * 24 * 60 * 60,
            )

        return response

    # no switch_to - full logout
    await delete_session(session.session_id)
    response = JSONResponse(content={"message": "logged out successfully"})

    if settings.frontend.url:
        is_localhost = settings.frontend.url.startswith("http://localhost")

        response.delete_cookie(
            key="session_id",
            httponly=True,
            secure=not is_localhost,
            samesite="lax",
        )

    return response


@router.get("/me")
async def get_current_user(
    session: Session = Depends(require_auth),
    db=Depends(get_db),
) -> CurrentUserResponse:
    """get current authenticated user with linked accounts."""
    # get all accounts in the session group (reuse db connection)
    linked = await get_session_group(session.session_id, db=db)

    # look up artist profiles to get fresh avatars and flags
    dids = [account.did for account in linked]
    avatar_map: dict[str, str | None] = {}
    current_user_flags: list[str] = []
    if dids:
        result = await db.execute(select(Artist).where(Artist.did.in_(dids)))
        for artist in result.scalars().all():
            avatar_map[artist.did] = artist.avatar_url
            # capture flags for the current user
            if artist.did == session.did:
                current_user_flags = artist.enabled_flags or []

    return CurrentUserResponse(
        did=session.did,
        handle=session.handle,
        linked_accounts=[
            LinkedAccountResponse(
                did=account.did,
                handle=account.handle,
                avatar_url=avatar_map.get(account.did),
            )
            for account in linked
        ],
        enabled_flags=current_user_flags,
    )


@router.get("/developer-tokens")
async def get_developer_tokens(
    session: Session = Depends(require_auth),
) -> DeveloperTokenListResponse:
    """list all developer tokens for the current user."""
    tokens = await list_developer_tokens(session.did)

    return DeveloperTokenListResponse(
        tokens=[
            DeveloperTokenInfo(
                session_id=t.session_id,
                name=t.token_name,
                created_at=t.created_at.isoformat(),
                expires_at=t.expires_at.isoformat() if t.expires_at else None,
            )
            for t in tokens
        ]
    )


@router.delete("/developer-tokens/{token_prefix}")
async def delete_developer_token(
    token_prefix: str,
    session: Session = Depends(require_auth),
) -> JSONResponse:
    """revoke a developer token by its prefix (first 8 chars of session_id)."""
    # find the full session_id from prefix
    tokens = await list_developer_tokens(session.did)
    matching = [t for t in tokens if t.session_id.startswith(token_prefix)]

    if not matching:
        raise HTTPException(status_code=404, detail="token not found")

    if len(matching) > 1:
        raise HTTPException(
            status_code=400,
            detail="ambiguous prefix - provide more characters",
        )

    success = await revoke_developer_token(session.did, matching[0].session_id)
    if not success:
        raise HTTPException(status_code=404, detail="token not found")

    return JSONResponse(content={"message": "token revoked successfully"})


class DevTokenStartRequest(BaseModel):
    """request model for starting developer token OAuth flow."""

    name: str | None = None
    expires_in_days: int | None = None


class DevTokenStartResponse(BaseModel):
    """response model with OAuth authorization URL."""

    auth_url: str


@router.post("/developer-token/start")
@limiter.limit(settings.rate_limit.auth_limit)
async def start_developer_token_flow(
    request: Request,
    body: DevTokenStartRequest,
    session: Session = Depends(require_auth),
) -> DevTokenStartResponse:
    """start OAuth flow to create a developer token with its own credentials.

    this initiates a new OAuth authorization flow. the user will be redirected
    to authorize, and on callback a dev token with independent OAuth credentials
    will be created. this ensures dev tokens don't become stale when browser
    sessions refresh their tokens.

    returns the authorization URL that the frontend should redirect to.
    """
    # validate expiration
    expires_in_days = (
        body.expires_in_days
        if body.expires_in_days is not None
        else settings.auth.developer_token_default_days
    )

    max_days = settings.auth.developer_token_max_days
    if expires_in_days > max_days:
        raise HTTPException(
            status_code=400,
            detail=f"expires_in_days cannot exceed {max_days}",
        )

    refresh_lifetime_days = get_refresh_token_lifetime_days(None)
    if expires_in_days <= 0 or expires_in_days > refresh_lifetime_days:
        expires_in_days = refresh_lifetime_days

    # start OAuth flow using the user's handle
    auth_url, state = await start_oauth_flow(session.handle)

    # save pending dev token metadata keyed by state
    await save_pending_dev_token(
        state=state,
        did=session.did,
        token_name=body.name,
        expires_in_days=expires_in_days,
    )

    return DevTokenStartResponse(auth_url=auth_url)


class ScopeUpgradeStartRequest(BaseModel):
    """request model for starting scope upgrade OAuth flow."""

    # for now, only teal scopes are supported
    include_teal: bool = True


class ScopeUpgradeStartResponse(BaseModel):
    """response model with OAuth authorization URL."""

    auth_url: str


@router.post("/scope-upgrade/start")
@limiter.limit(settings.rate_limit.auth_limit)
async def start_scope_upgrade_flow(
    request: Request,
    body: ScopeUpgradeStartRequest,
    session: Session = Depends(require_auth),
) -> ScopeUpgradeStartResponse:
    """start OAuth flow to upgrade session scopes.

    this initiates a new OAuth authorization flow with expanded scopes.
    the user will be redirected to authorize, and on callback the old session
    will be replaced with a new session that has the requested scopes.

    use this when a user enables a feature that requires additional OAuth scopes
    (e.g., enabling teal.fm scrobbling which needs fm.teal.alpha.* scopes).

    returns the authorization URL that the frontend should redirect to.
    """
    # start OAuth flow with the requested scopes
    auth_url, state = await start_oauth_flow_with_scopes(
        session.handle, include_teal=body.include_teal
    )

    # build the requested scopes string for logging/tracking
    requested_scopes = "teal" if body.include_teal else "base"

    # save pending scope upgrade metadata keyed by state
    await save_pending_scope_upgrade(
        state=state,
        did=session.did,
        old_session_id=session.session_id,
        requested_scopes=requested_scopes,
    )

    return ScopeUpgradeStartResponse(auth_url=auth_url)


# multi-account endpoints


class AddAccountStartRequest(BaseModel):
    """request model for starting add-account flow."""

    handle: str


class AddAccountStartResponse(BaseModel):
    """response model with OAuth authorization URL for adding account."""

    auth_url: str


@router.post("/add-account/start")
@limiter.limit(settings.rate_limit.auth_limit)
async def start_add_account_flow(
    request: Request,
    body: AddAccountStartRequest,
    session: Session = Depends(require_auth),
) -> AddAccountStartResponse:
    """start OAuth flow to add another account to the session group.

    the user must provide the handle of the account they want to add.
    this initiates a new OAuth authorization flow with prompt=login to force
    fresh authentication. the new account will be linked to the same session
    group as the current account, enabling quick switching between accounts.

    returns the authorization URL that the frontend should redirect to.
    """
    # check if the handle is already in the session group
    linked_accounts = await get_session_group(session.session_id)
    for account in linked_accounts:
        if body.handle.lower() == account.handle.lower():
            raise HTTPException(
                status_code=400,
                detail="you're already logged into this account",
            )

    # get or create a group_id for the current session
    group_id = await get_or_create_group_id(session.session_id)

    # start OAuth flow with the NEW handle and prompt=login to force fresh auth
    auth_url, state = await start_oauth_flow(body.handle, prompt="login")

    # save pending add-account metadata keyed by state
    await save_pending_add_account(state=state, group_id=group_id)

    return AddAccountStartResponse(auth_url=auth_url)


class SwitchAccountRequest(BaseModel):
    """request model for switching to a different account."""

    target_did: str


class SwitchAccountResponse(BaseModel):
    """response model after switching accounts."""

    did: str
    handle: str
    session_id: str


@router.post("/switch-account")
async def switch_account(
    body: SwitchAccountRequest,
    response: Response,
    session: Session = Depends(require_auth),
    db=Depends(get_db),
) -> SwitchAccountResponse:
    """switch to a different account in the session group.

    switches the active account within the session group. the cookie is updated
    to point to the new session, and the old session is marked inactive.

    returns the new active account's info.
    """
    # get all accounts in the group (reuse db connection)
    linked = await get_session_group(session.session_id, db=db)

    if not linked:
        raise HTTPException(
            status_code=400,
            detail="no linked accounts - use add-account to link accounts first",
        )

    # find the target session
    target = next((a for a in linked if a.did == body.target_did), None)
    if not target:
        raise HTTPException(
            status_code=404,
            detail="target account not found in session group",
        )

    if target.did == session.did:
        raise HTTPException(
            status_code=400,
            detail="already logged in as this account",
        )

    # switch the active account (reuse db connection)
    new_session_id = await switch_active_account(
        session.session_id, target.session_id, db=db
    )

    # update the cookie to point to the new session
    if settings.frontend.url:
        is_localhost = settings.frontend.url.startswith("http://localhost")

        response.set_cookie(
            key="session_id",
            value=new_session_id,
            httponly=True,
            secure=not is_localhost,
            samesite="lax",
            max_age=14 * 24 * 60 * 60,
        )

    return SwitchAccountResponse(
        did=target.did,
        handle=target.handle,
        session_id=new_session_id,
    )


@router.post("/logout-all")
async def logout_all(
    session: Session = Depends(require_auth),
    db=Depends(get_db),
) -> JSONResponse:
    """logout all accounts in the session group.

    removes all sessions in the group and clears the cookie.
    """
    # get all accounts in the group (reuse db connection)
    linked = await get_session_group(session.session_id, db=db)

    # delete all sessions (or just this one if not in a group)
    if linked:
        for account in linked:
            await delete_session(account.session_id)
    else:
        await delete_session(session.session_id)

    response = JSONResponse(content={"message": "all accounts logged out"})

    if settings.frontend.url:
        is_localhost = settings.frontend.url.startswith("http://localhost")

        response.delete_cookie(
            key="session_id",
            httponly=True,
            secure=not is_localhost,
            samesite="lax",
        )

    return response

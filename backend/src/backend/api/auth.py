"""authentication api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from starlette.responses import Response

from backend._internal import (
    Session,
    check_artist_profile_exists,
    consume_exchange_token,
    create_exchange_token,
    create_session,
    delete_session,
    handle_oauth_callback,
    list_developer_tokens,
    require_auth,
    revoke_developer_token,
    start_oauth_flow,
)
from backend.config import settings
from backend.utilities.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])


class CurrentUserResponse(BaseModel):
    """response model for current user endpoint."""

    did: str
    handle: str


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
    """
    did, handle, oauth_session = await handle_oauth_callback(code, state, iss)
    session_id = await create_session(did, handle, oauth_session)

    # create one-time exchange token (expires in 60 seconds)
    exchange_token = await create_exchange_token(session_id)

    # check if artist profile exists
    has_profile = await check_artist_profile_exists(did)

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
    """
    session_id = await consume_exchange_token(exchange_request.exchange_token)

    if not session_id:
        raise HTTPException(
            status_code=401,
            detail="invalid, expired, or already used exchange token",
        )

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
) -> JSONResponse:
    """logout current user."""
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
) -> CurrentUserResponse:
    """get current authenticated user."""
    return CurrentUserResponse(
        did=session.did,
        handle=session.handle,
    )


class DeveloperTokenRequest(BaseModel):
    """request model for creating developer tokens."""

    name: str | None = None  # optional friendly name for the token
    expires_in_days: int | None = None  # None = use default from settings


class DeveloperTokenResponse(BaseModel):
    """response model for developer token creation."""

    token: str
    expires_in_days: int
    message: str


class DeveloperTokenInfo(BaseModel):
    """info about a developer token (without the actual token)."""

    session_id: str  # first 8 chars only for identification
    name: str | None
    created_at: str  # ISO format
    expires_at: str | None  # ISO format or null for never


class DeveloperTokenListResponse(BaseModel):
    """response model for listing developer tokens."""

    tokens: list[DeveloperTokenInfo]


@router.get("/developer-tokens")
async def get_developer_tokens(
    session: Session = Depends(require_auth),
) -> DeveloperTokenListResponse:
    """list all developer tokens for the current user."""
    tokens = await list_developer_tokens(session.did)

    return DeveloperTokenListResponse(
        tokens=[
            DeveloperTokenInfo(
                session_id=t.session_id[:8],  # only show prefix for identification
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


@router.post("/developer-token")
@limiter.limit(settings.rate_limit.auth_limit)
async def create_developer_token(
    request: Request,
    token_request: DeveloperTokenRequest,
    session: Session = Depends(require_auth),
) -> DeveloperTokenResponse:
    """create a long-lived developer token for programmatic API access.

    this creates a new session with a configurable expiration.
    the token can be used as a Bearer token for API requests.

    use expires_in_days=0 for a token that never expires.
    """
    # use default from settings if not specified
    expires_in_days = (
        token_request.expires_in_days
        if token_request.expires_in_days is not None
        else settings.auth.developer_token_default_days
    )

    # cap expiration at max from settings (0 = no expiration is always allowed)
    max_days = settings.auth.developer_token_max_days
    if expires_in_days > max_days:
        raise HTTPException(
            status_code=400,
            detail=f"expires_in_days cannot exceed {max_days} (use 0 for no expiration)",
        )

    # create a new session with the user's OAuth data but longer expiration
    token = await create_session(
        did=session.did,
        handle=session.handle,
        oauth_session=session.oauth_session,
        expires_in_days=expires_in_days,
        is_developer_token=True,
        token_name=token_request.name,
    )

    expires_msg = (
        f"expires in {expires_in_days} days" if expires_in_days > 0 else "never expires"
    )

    return DeveloperTokenResponse(
        token=token,
        expires_in_days=expires_in_days,
        message=f"Developer token created ({expires_msg}). "
        "Use as: Authorization: Bearer <token>",
    )

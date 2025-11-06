"""authentication api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from backend._internal import (
    Session,
    check_artist_profile_exists,
    consume_exchange_token,
    create_exchange_token,
    create_session,
    delete_session,
    handle_oauth_callback,
    require_auth,
    start_oauth_flow,
)
from backend.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


class CurrentUserResponse(BaseModel):
    """response model for current user endpoint."""

    did: str
    handle: str


@router.get("/start")
async def start_login(handle: str) -> RedirectResponse:
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
async def exchange_token(request: ExchangeTokenRequest) -> ExchangeTokenResponse:
    """exchange one-time token for session_id.

    frontend calls this immediately after OAuth callback to securely
    exchange the short-lived token for the actual session_id.
    """
    session_id = await consume_exchange_token(request.exchange_token)

    if not session_id:
        raise HTTPException(
            status_code=401,
            detail="invalid, expired, or already used exchange token",
        )

    return ExchangeTokenResponse(session_id=session_id)


@router.post("/logout")
async def logout(session: Session = Depends(require_auth)) -> dict:
    """logout current user."""
    await delete_session(session.session_id)
    return {"message": "logged out successfully"}


@router.get("/me")
async def get_current_user(
    session: Session = Depends(require_auth),
) -> CurrentUserResponse:
    """get current authenticated user."""
    return CurrentUserResponse(
        did=session.did,
        handle=session.handle,
    )

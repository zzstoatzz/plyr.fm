"""authentication api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from relay._internal import (
    Session,
    check_artist_profile_exists,
    create_session,
    delete_session,
    handle_oauth_callback,
    require_auth,
    start_oauth_flow,
)
from relay.config import settings

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
    """handle OAuth callback and create session."""
    did, handle, oauth_session = await handle_oauth_callback(code, state, iss)
    session_id = await create_session(did, handle, oauth_session)

    # check if artist profile exists
    has_profile = await check_artist_profile_exists(did)

    # redirect to profile setup if needed, otherwise to portal
    redirect_path = "/portal" if has_profile else "/profile/setup"

    # pass session_id as URL parameter for cross-domain auth
    response = RedirectResponse(
        url=f"{settings.frontend_url}{redirect_path}?session_id={session_id}",
        status_code=303,
    )
    return response


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

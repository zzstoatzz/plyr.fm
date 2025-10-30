"""authentication api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, RedirectResponse

from relay.auth import (
    Session,
    create_session,
    delete_session,
    handle_oauth_callback,
    require_auth,
    start_oauth_flow,
)

router = APIRouter(prefix="/auth", tags=["auth"])


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
    session_id = create_session(did, handle, oauth_session)

    # redirect to localhost endpoint to set cookie properly for localhost domain
    response = RedirectResponse(
        url=f"http://localhost:8001/auth/session?session_id={session_id}",
        status_code=303
    )
    return response


@router.get("/session")
async def set_session_cookie(session_id: str) -> RedirectResponse:
    """intermediate endpoint to set session cookie for localhost domain."""
    response = RedirectResponse(url="http://localhost:5173", status_code=303)
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=False,
        samesite="lax",
        domain="localhost",
    )
    return response


@router.post("/logout")
async def logout(session: Session = Depends(require_auth)) -> dict:
    """logout current user."""
    delete_session(session.session_id)
    return {"message": "logged out successfully"}


@router.get("/me")
async def get_current_user(session: Session = Depends(require_auth)) -> dict:
    """get current authenticated user."""
    return {
        "did": session.did,
        "handle": session.handle,
    }

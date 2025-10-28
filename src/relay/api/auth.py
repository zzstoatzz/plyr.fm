"""authentication api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Form
from fastapi.responses import JSONResponse

from relay.auth import Session, create_session, delete_session, require_auth, verify_app_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(
    handle: Annotated[str, Form()],
    app_password: Annotated[str, Form()],
) -> JSONResponse:
    """login with atproto app password."""
    did, verified_handle = verify_app_password(handle, app_password)
    session_id = create_session(did, verified_handle)

    response = JSONResponse(
        content={
            "did": did,
            "handle": verified_handle,
            "message": "logged in successfully",
        }
    )
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=False,  # set to True in production with HTTPS
        samesite="lax",
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

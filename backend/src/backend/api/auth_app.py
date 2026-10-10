"""native app sign-in: start the flow, and the redirect that ends it."""

from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, field_validator

from backend._internal import start_oauth_flow_for_pds
from backend._internal.atproto.handles import resolve_handle
from backend._internal.auth.app_login import (
    is_pkce_challenge,
    save_pending_app_login,
)
from backend._internal.auth.oauth import start_native_app_oauth_flow
from backend.config import settings
from backend.utilities.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth"])


class AppLoginStartRequest(BaseModel):
    """request model for starting a native app sign-in."""

    handle: str | None = None
    pds_url: str | None = None
    code_challenge: str

    @field_validator("code_challenge")
    @classmethod
    def challenge_is_s256(cls, v: str) -> str:
        if not is_pkce_challenge(v):
            raise ValueError("code_challenge must be an S256 PKCE challenge")
        return v


class AppLoginStartResponse(BaseModel):
    """response model with OAuth authorization URL."""

    auth_url: str


@router.post("/app/start")
@limiter.limit(settings.rate_limit.auth_limit)
async def start_app_login(
    request: Request,
    body: AppLoginStartRequest,
) -> AppLoginStartResponse:
    """start OAuth sign-in or account creation for the native app.

    the app opens ``auth_url`` in a system auth session. the callback sends it
    back to ``ATPROTO_NATIVE_APP_REDIRECT_URI`` with a one-time ``code`` bound
    to ``code_challenge``; ``POST /auth/exchange`` with the code and the PKCE
    verifier returns the session id, which the app sends as a bearer token.

    the grant is ``native_app_scope`` only, whatever the account holds on the web.
    exactly one of ``handle`` or ``pds_url`` must be provided.
    """
    if bool(body.handle) == bool(body.pds_url):
        raise HTTPException(
            status_code=400, detail="provide exactly one of handle or pds_url"
        )

    if body.pds_url:
        if not settings.account_creation.enabled:
            raise HTTPException(
                status_code=403, detail="account creation is not enabled"
            )
        auth_url, state = await start_oauth_flow_for_pds(
            body.pds_url, scope=settings.atproto.native_app_scope
        )
    else:
        assert body.handle is not None
        try:
            auth_url, state = await start_native_app_oauth_flow(body.handle)
        except HTTPException:
            if body.handle.startswith("did:") or await resolve_handle(body.handle):
                raise
            raise HTTPException(status_code=404, detail="handle_not_found") from None

    await save_pending_app_login(state, body.code_challenge)
    return AppLoginStartResponse(auth_url=auth_url)


def app_redirect(**params: str) -> RedirectResponse:
    """send the system auth session back to the native app."""
    return RedirectResponse(
        url=f"{settings.atproto.native_app_redirect_uri}?{urlencode(params)}",
        status_code=303,
    )

"""copyright paradigm api endpoints.

a copyright paradigm is an opt-in shape for capturing rights metadata about a
track. the first paradigm is indiemusi.ch alpha; the API is shaped so future
paradigms can plug in without changing the endpoint contract.
"""

import logging

from atproto_oauth.scopes import ScopesSet
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend._internal import (
    Session,
    require_auth,
    save_pending_scope_upgrade,
    start_oauth_flow_with_scopes,
)
from backend._internal.atproto.records.ch_indiemusi import (
    PublishingOwnerInput,
)
from backend._internal.atproto.records.fm_plyr.track import delete_record_by_uri
from backend._internal.copyright import (
    complete_indiemusi_setup,
    delete_user_copyright_config,
    get_user_copyright_config,
)
from backend.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/copyright", tags=["copyright"])


# --- response models ---------------------------------------------------------


class CopyrightConfigResponse(BaseModel):
    """current copyright paradigm state for a user."""

    paradigm: str
    config_uri: str | None
    paradigm_data: dict | None


class CopyrightSetupRequest(BaseModel):
    """opt into a copyright paradigm. payload schema depends on paradigm."""

    paradigm: str
    publishing_owner: PublishingOwnerInput


class CopyrightSetupResponse(BaseModel):
    """result of /copyright/setup.

    when scope upgrade is required, auth_url is the URL the frontend should
    redirect to. when the current session already has the paradigm's scopes,
    the setup completes directly and auth_url is null.
    """

    auth_url: str | None = None
    complete: bool = False


# --- scope helpers -----------------------------------------------------------


def _has_indiemusi_scopes(session: Session) -> bool:
    """check if the session has scopes to write indiemusi records."""
    if not session.oauth_session:
        return False
    scopes = ScopesSet.from_string(session.oauth_session.get("scope", ""))
    return scopes.matches(
        "repo", collection=settings.indiemusi.song_collection, action="create"
    )


# --- endpoints ---------------------------------------------------------------


@router.get("/config")
async def get_config(
    session: Session = Depends(require_auth),
) -> CopyrightConfigResponse | None:
    """return the user's current copyright config, or null if none."""
    cfg = await get_user_copyright_config(session.did)
    if not cfg:
        return None
    return CopyrightConfigResponse(
        paradigm=cfg.paradigm,
        config_uri=cfg.config_uri,
        paradigm_data=cfg.paradigm_data,
    )


@router.post("/setup")
async def setup(
    body: CopyrightSetupRequest,
    session: Session = Depends(require_auth),
) -> CopyrightSetupResponse:
    """opt into a copyright paradigm.

    if the session already has the required scopes, writes the paradigm actor
    record immediately and returns `complete=True`. otherwise, kicks off an
    OAuth scope upgrade and returns `auth_url` for the frontend to redirect to;
    the callback finishes the write once the new session is in place.
    """
    if body.paradigm != settings.indiemusi.paradigm_id:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported paradigm: {body.paradigm!r}",
        )
    if not settings.indiemusi.enabled:
        raise HTTPException(status_code=404, detail="indiemusi paradigm disabled")

    paradigm_data = body.publishing_owner.model_dump(by_alias=True, exclude_none=True)

    if _has_indiemusi_scopes(session):
        # session already has scopes — write directly, no OAuth round-trip
        await complete_indiemusi_setup(session, paradigm_data)
        return CopyrightSetupResponse(complete=True)

    # need a scope upgrade — stash the payload and redirect through OAuth
    auth_url, state = await start_oauth_flow_with_scopes(
        session.handle, include_indiemusi=True
    )
    await save_pending_scope_upgrade(
        state=state,
        did=session.did,
        old_session_id=session.session_id,
        requested_scopes="indiemusi",
        paradigm_data=paradigm_data,
        redirect_to="/portal",
    )
    return CopyrightSetupResponse(auth_url=auth_url)


@router.post("/disconnect")
async def disconnect(
    session: Session = Depends(require_auth),
) -> dict[str, bool]:
    """delete the user's copyright config and best-effort delete the PDS record."""
    cfg = await get_user_copyright_config(session.did)
    if not cfg:
        return {"deleted": False}

    if cfg.config_uri:
        try:
            await delete_record_by_uri(session, cfg.config_uri)
        except Exception as e:
            # best-effort — we still want to clear the local row even if PDS write fails
            logger.warning(
                "failed to delete PDS record %s for %s: %s",
                cfg.config_uri,
                session.did,
                e,
            )

    await delete_user_copyright_config(session.did)
    return {"deleted": True}

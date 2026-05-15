"""copyright paradigm api endpoints.

a copyright paradigm is an opt-in shape for capturing rights metadata about a
track. the first paradigm is indiemusi.ch alpha; the API is shaped so future
paradigms can plug in without changing the endpoint contract.

owner-record management is exposed as a small CRUD surface (list / create /
edit / use / delete) over the user's PDS records, modeled like our tag UX:
load what's already there, let the user pick or extend, never silently
clobber records other clients may have written.
"""

import logging
from typing import Annotated, Any

from atproto_oauth.scopes import ScopesSet
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy import select

from backend._internal import (
    Session,
    has_flag,
    require_auth,
    save_pending_scope_upgrade,
    start_oauth_flow_with_scopes,
)
from backend._internal.atproto.client import parse_at_uri
from backend._internal.atproto.records.ch_indiemusi import (
    PublishingOwnerInput,
    list_publishing_owner_records,
)
from backend._internal.atproto.records.fm_plyr.track import delete_record_by_uri
from backend._internal.copyright import (
    create_owner_for_user,
    delete_owner_for_user,
    delete_user_copyright_config,
    edit_owner_for_user,
    get_user_copyright_config,
    use_owner_for_user,
)
from backend.config import settings
from backend.models import Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/copyright", tags=["copyright"])

# feature flag for the entire copyright-paradigm surface. ungated user
# requests get a 404 — same shape they'd see for any unmounted endpoint, so
# we don't leak the existence of the feature to users we haven't enrolled.
COPYRIGHT_PARADIGM_FLAG = "copyright-paradigm"


async def _require_copyright_flag(session: Session) -> None:
    """guard every /copyright/* endpoint behind the per-user feature flag.

    flagged users see normal behavior; everyone else gets a 404 (not 403) so
    the existence of the feature isn't leaked while we're rolling out.
    """
    async with db_session() as db:
        if not await has_flag(db, session.did, COPYRIGHT_PARADIGM_FLAG):
            raise HTTPException(status_code=404, detail="not found")


# --- response models -------------------------------------------------------


class CopyrightConfigResponse(BaseModel):
    """current copyright paradigm state for a user."""

    paradigm: str
    config_uri: str | None
    paradigm_data: dict | None


class PublishingOwnerRecordView(BaseModel):
    """one publishingOwner record as listed in the portal."""

    uri: str
    rkey: str
    cid: str | None = None
    value: dict[str, Any]
    in_use: bool


class PublishingOwnersListResponse(BaseModel):
    """list response with the user's existing publishingOwner records.

    `needs_scope_upgrade` is True when the session lacks write scopes —
    the portal uses it to show a "grant write access" banner before the
    user tries to create/edit/delete.
    """

    records: list[PublishingOwnerRecordView]
    needs_scope_upgrade: bool


class CopyrightWriteRequest(BaseModel):
    """create/edit payload — the validated PublishingOwnerInput."""

    publishing_owner: PublishingOwnerInput


class CopyrightUseRequest(BaseModel):
    """link an existing publishingOwner URI as the user's in-use config."""

    uri: str


class CopyrightOpResponse(BaseModel):
    """result of any single-shot copyright op.

    when scope upgrade is required, `auth_url` is the URL the frontend should
    redirect to. when the session already has scopes, the op completes
    directly and `complete=True`. `uri` is the resulting record URI (or the
    one passed in for `use`).
    """

    auth_url: str | None = None
    complete: bool = False
    uri: str | None = None


class CopyrightTrackRef(BaseModel):
    """summary of a track that's blocking copyright disconnect."""

    id: int
    title: str


class CopyrightDisconnectBlockedDetail(BaseModel):
    """409 body when disconnect is blocked by extant copyright-gated tracks."""

    message: str
    blocked_by_tracks: list[CopyrightTrackRef]


# --- scope helpers ---------------------------------------------------------


def _has_indiemusi_scopes(session: Session) -> bool:
    """check if the session has scopes to write indiemusi records."""
    if not session.oauth_session:
        return False
    scopes = ScopesSet.from_string(session.oauth_session.get("scope", ""))
    return scopes.matches(
        "repo", collection=settings.indiemusi.song_collection, action="create"
    )


async def _require_paradigm_enabled(paradigm: str | None = None) -> None:
    """guard: paradigm must be enabled. only the indiemusi paradigm exists today."""
    if not settings.indiemusi.enabled:
        raise HTTPException(status_code=404, detail="indiemusi paradigm disabled")
    if paradigm is not None and paradigm != settings.indiemusi.paradigm_id:
        raise HTTPException(
            status_code=400, detail=f"unsupported paradigm: {paradigm!r}"
        )


async def _start_indiemusi_upgrade(
    session: Session, paradigm_data: dict[str, Any]
) -> str:
    """kick off the OAuth scope upgrade and stash a pending action.

    returns the auth_url the frontend should redirect to. the callback runs
    `complete_indiemusi_setup` with the stashed paradigm_data once the new
    session is in place.
    """
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
    return auth_url


# --- config endpoint -------------------------------------------------------


@router.get("/config")
async def get_config(
    session: Session = Depends(require_auth),
) -> CopyrightConfigResponse | None:
    """return the user's current copyright config, or null if none."""
    await _require_copyright_flag(session)
    cfg = await get_user_copyright_config(session.did)
    if not cfg:
        return None
    return CopyrightConfigResponse(
        paradigm=cfg.paradigm,
        config_uri=cfg.config_uri,
        paradigm_data=cfg.paradigm_data,
    )


# --- publishingOwner CRUD --------------------------------------------------


@router.get("/publishing-owners")
async def list_publishing_owners(
    session: Session = Depends(require_auth),
) -> PublishingOwnersListResponse:
    """list the user's publishingOwner records on their PDS, with in_use marker.

    public read against the user's repo — doesn't require indiemusi scopes.
    `in_use` is derived by comparing each URI to the user's config_uri.
    """
    await _require_copyright_flag(session)
    await _require_paradigm_enabled()

    records_raw = await list_publishing_owner_records(session)
    cfg = await get_user_copyright_config(session.did)
    in_use_uri = cfg.config_uri if cfg else None

    records: list[PublishingOwnerRecordView] = []
    for raw in records_raw:
        uri = raw.get("uri")
        value = raw.get("value")
        if not isinstance(uri, str) or not isinstance(value, dict):
            continue
        try:
            _, _, rkey = parse_at_uri(uri)
        except Exception:
            continue
        records.append(
            PublishingOwnerRecordView(
                uri=uri,
                rkey=rkey,
                cid=raw.get("cid") if isinstance(raw.get("cid"), str) else None,
                value=value,
                in_use=uri == in_use_uri,
            )
        )

    return PublishingOwnersListResponse(
        records=records,
        needs_scope_upgrade=not _has_indiemusi_scopes(session),
    )


@router.post("/publishing-owners")
async def create_publishing_owner(
    body: CopyrightWriteRequest,
    session: Session = Depends(require_auth),
) -> CopyrightOpResponse:
    """create a new publishingOwner record on the user's PDS.

    if the session lacks indiemusi scopes, kicks off an OAuth scope upgrade
    and returns auth_url — the callback finalizes the create after sign-in.
    when the user has no config row yet, the new record becomes their in-use
    publishingOwner (the typical first-time setup path).
    """
    await _require_copyright_flag(session)
    await _require_paradigm_enabled()

    if _has_indiemusi_scopes(session):
        cfg = await get_user_copyright_config(session.did)
        use_as_config = cfg is None or cfg.config_uri is None
        uri, _data = await create_owner_for_user(
            session, body.publishing_owner, use_as_config=use_as_config
        )
        return CopyrightOpResponse(complete=True, uri=uri)

    # scope-upgrade path: stash a `create` action; callback runs it
    auth_url = await _start_indiemusi_upgrade(
        session,
        paradigm_data={
            "action": "create",
            "publishing_owner": body.publishing_owner.model_dump(
                by_alias=True, exclude_none=True
            ),
        },
    )
    return CopyrightOpResponse(auth_url=auth_url)


@router.put("/publishing-owners/{rkey}")
async def edit_publishing_owner(
    rkey: Annotated[str, Path(min_length=1, max_length=128)],
    body: CopyrightWriteRequest,
    session: Session = Depends(require_auth),
) -> CopyrightOpResponse:
    """edit an existing publishingOwner record with merge-preserve semantics.

    re-fetches the record fresh from PDS before putRecord, drops the keys
    plyr models so individual↔company switches actually clear stale fields,
    and preserves any unknown keys other clients may have written.

    if scopes are missing, kicks off OAuth and finalizes via callback.
    """
    await _require_copyright_flag(session)
    await _require_paradigm_enabled()
    uri = f"at://{session.did}/{settings.indiemusi.publishing_owner_collection}/{rkey}"

    if _has_indiemusi_scopes(session):
        try:
            await edit_owner_for_user(session, uri, body.publishing_owner)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return CopyrightOpResponse(complete=True, uri=uri)

    auth_url = await _start_indiemusi_upgrade(
        session,
        paradigm_data={
            "action": "edit",
            "uri": uri,
            "publishing_owner": body.publishing_owner.model_dump(
                by_alias=True, exclude_none=True
            ),
        },
    )
    return CopyrightOpResponse(auth_url=auth_url)


@router.delete("/publishing-owners/{rkey}")
async def delete_publishing_owner(
    rkey: Annotated[str, Path(min_length=1, max_length=128)],
    session: Session = Depends(require_auth),
) -> CopyrightOpResponse:
    """delete a publishingOwner record from the user's PDS.

    if the record was in use, clears config_uri + paradigm_data on the local
    row (the user must pick or create another before writing rights again).
    needs write scope — OAuth upgrade if missing, but the upgrade flow does
    NOT carry the delete action through the callback today (deletes are
    rare; the user can retry after the upgrade). returns 412 in that case
    so the frontend can prompt the user to grant access first.
    """
    await _require_copyright_flag(session)
    await _require_paradigm_enabled()
    uri = f"at://{session.did}/{settings.indiemusi.publishing_owner_collection}/{rkey}"

    if not _has_indiemusi_scopes(session):
        raise HTTPException(
            status_code=412,
            detail=(
                "deleting a publishingOwner record requires write access; "
                "grant indiemusi scopes first, then retry"
            ),
        )

    try:
        await delete_owner_for_user(session, uri)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return CopyrightOpResponse(complete=True, uri=uri)


@router.post("/use-owner")
async def use_publishing_owner(
    body: CopyrightUseRequest,
    session: Session = Depends(require_auth),
) -> CopyrightOpResponse:
    """point user_copyright_configs at an existing publishingOwner record.

    DB-only — no PDS write. validates the URI belongs to the session user
    and the collection is publishingOwner, then caches modeled fields for
    prefill and saves the row.

    if scopes are missing, this still succeeds (link is DB-only). the
    portal's `needs_scope_upgrade` flag from the list endpoint tells the UI
    when to nudge for write access separately.
    """
    await _require_copyright_flag(session)
    await _require_paradigm_enabled()
    try:
        await use_owner_for_user(session, body.uri)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return CopyrightOpResponse(complete=True, uri=body.uri)


# --- disconnect ------------------------------------------------------------


@router.post("/disconnect")
async def disconnect(
    session: Session = Depends(require_auth),
) -> dict[str, bool]:
    """delete the user's copyright config and best-effort delete the PDS record.

    refuses with 409 when the user still has tracks carrying rights metadata —
    those would be left orphaned (gated, with no paradigm config to update or
    clear them through). users must clear each via DELETE /tracks/{id}/copyright
    before disconnecting.
    """
    await _require_copyright_flag(session)
    cfg = await get_user_copyright_config(session.did)
    if not cfg:
        return {"deleted": False}

    async with db_session() as db:
        blocking = (
            await db.execute(
                select(Track.id, Track.title)
                .where(Track.artist_did == session.did)
                .where(Track.copyright_song_uri.is_not(None))
                .order_by(Track.created_at.desc())
                .limit(100)
            )
        ).all()

    if blocking:
        raise HTTPException(
            status_code=409,
            detail=CopyrightDisconnectBlockedDetail(
                message=(
                    f"{len(blocking)} track(s) still carry copyright metadata. "
                    "clear them first via the edit form, then disconnect."
                ),
                blocked_by_tracks=[
                    CopyrightTrackRef(id=t.id, title=t.title) for t in blocking
                ],
            ).model_dump(),
        )

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


# --- legacy alias ----------------------------------------------------------
#
# /copyright/setup was the old single-form "opt in + create" endpoint. it's
# now an alias for `POST /publishing-owners` so existing frontend deploys
# (and the in-flight scope-upgrade callbacks that reference paradigm_id) keep
# working through the deploy window. remove after the next frontend roll.


class _LegacySetupRequest(BaseModel):
    paradigm: str
    publishing_owner: PublishingOwnerInput


@router.post("/setup", deprecated=True)
async def legacy_setup(
    body: _LegacySetupRequest,
    session: Session = Depends(require_auth),
) -> CopyrightOpResponse:
    """legacy alias for POST /publishing-owners — to be removed."""
    await _require_copyright_flag(session)
    await _require_paradigm_enabled(body.paradigm)
    return await create_publishing_owner(
        CopyrightWriteRequest(publishing_owner=body.publishing_owner), session
    )

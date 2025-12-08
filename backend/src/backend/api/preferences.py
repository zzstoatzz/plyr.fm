"""user preferences api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.models import UserPreferences, get_db
from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

router = APIRouter(prefix="/preferences", tags=["preferences"])


class PreferencesResponse(BaseModel):
    """user preferences response model."""

    accent_color: str
    auto_advance: bool
    allow_comments: bool
    hidden_tags: list[str]
    enable_teal_scrobbling: bool
    # indicates if user needs to re-login to activate teal scrobbling
    teal_needs_reauth: bool = False
    show_sensitive_artwork: bool = False
    show_liked_on_profile: bool = False


class PreferencesUpdate(BaseModel):
    """user preferences update model."""

    accent_color: str | None = None
    auto_advance: bool | None = None
    allow_comments: bool | None = None
    hidden_tags: list[str] | None = None
    enable_teal_scrobbling: bool | None = None
    show_sensitive_artwork: bool | None = None
    show_liked_on_profile: bool | None = None


def _has_teal_scope(session: Session) -> bool:
    """check if session has teal.fm scopes."""
    if not session.oauth_session:
        return False
    scope = session.oauth_session.get("scope", "")
    return settings.teal.play_collection in scope


@router.get("/")
async def get_preferences(
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> PreferencesResponse:
    """get user preferences (creates default if not exists)."""
    result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == session.did)
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        # create default preferences
        prefs = UserPreferences(
            did=session.did,
            accent_color="#6a9fff",
            hidden_tags=list(DEFAULT_HIDDEN_TAGS),
        )
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)

    # check if user wants teal but doesn't have the scope
    has_scope = _has_teal_scope(session)
    teal_needs_reauth = prefs.enable_teal_scrobbling and not has_scope

    return PreferencesResponse(
        accent_color=prefs.accent_color,
        auto_advance=prefs.auto_advance,
        allow_comments=prefs.allow_comments,
        hidden_tags=prefs.hidden_tags or [],
        enable_teal_scrobbling=prefs.enable_teal_scrobbling,
        teal_needs_reauth=teal_needs_reauth,
        show_sensitive_artwork=prefs.show_sensitive_artwork,
        show_liked_on_profile=prefs.show_liked_on_profile,
    )


@router.post("/")
async def update_preferences(
    update: PreferencesUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> PreferencesResponse:
    """update user preferences."""
    result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == session.did)
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        # create new preferences
        prefs = UserPreferences(
            did=session.did,
            accent_color=update.accent_color or "#6a9fff",
            auto_advance=update.auto_advance
            if update.auto_advance is not None
            else True,
            allow_comments=update.allow_comments
            if update.allow_comments is not None
            else False,
            hidden_tags=update.hidden_tags
            if update.hidden_tags is not None
            else list(DEFAULT_HIDDEN_TAGS),
            enable_teal_scrobbling=update.enable_teal_scrobbling
            if update.enable_teal_scrobbling is not None
            else False,
            show_sensitive_artwork=update.show_sensitive_artwork
            if update.show_sensitive_artwork is not None
            else False,
            show_liked_on_profile=update.show_liked_on_profile
            if update.show_liked_on_profile is not None
            else False,
        )
        db.add(prefs)
    else:
        # update existing
        if update.accent_color is not None:
            prefs.accent_color = update.accent_color
        if update.auto_advance is not None:
            prefs.auto_advance = update.auto_advance
        if update.allow_comments is not None:
            prefs.allow_comments = update.allow_comments
        if update.hidden_tags is not None:
            prefs.hidden_tags = update.hidden_tags
        if update.enable_teal_scrobbling is not None:
            prefs.enable_teal_scrobbling = update.enable_teal_scrobbling
        if update.show_sensitive_artwork is not None:
            prefs.show_sensitive_artwork = update.show_sensitive_artwork
        if update.show_liked_on_profile is not None:
            prefs.show_liked_on_profile = update.show_liked_on_profile

    await db.commit()
    await db.refresh(prefs)

    # check if user wants teal but doesn't have the scope
    has_scope = _has_teal_scope(session)
    teal_needs_reauth = prefs.enable_teal_scrobbling and not has_scope

    return PreferencesResponse(
        accent_color=prefs.accent_color,
        auto_advance=prefs.auto_advance,
        allow_comments=prefs.allow_comments,
        hidden_tags=prefs.hidden_tags or [],
        enable_teal_scrobbling=prefs.enable_teal_scrobbling,
        teal_needs_reauth=teal_needs_reauth,
        show_sensitive_artwork=prefs.show_sensitive_artwork,
        show_liked_on_profile=prefs.show_liked_on_profile,
    )

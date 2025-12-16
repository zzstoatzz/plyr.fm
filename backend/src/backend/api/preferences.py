"""user preferences api endpoints."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.models import UserPreferences, get_db
from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

router = APIRouter(prefix="/preferences", tags=["preferences"])

# magic value for atprotofans support link mode
ATPROTOFANS_MODE = "atprotofans"


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
    support_url: str | None = None
    # extensible UI settings (background_image_url, glass_effects, custom_colors, etc.)
    ui_settings: dict[str, Any] = {}


class PreferencesUpdate(BaseModel):
    """user preferences update model."""

    accent_color: str | None = None
    auto_advance: bool | None = None
    allow_comments: bool | None = None
    hidden_tags: list[str] | None = None
    enable_teal_scrobbling: bool | None = None
    show_sensitive_artwork: bool | None = None
    show_liked_on_profile: bool | None = None
    support_url: str | None = None
    ui_settings: dict[str, Any] | None = None

    @field_validator("support_url", mode="before")
    @classmethod
    def validate_support_url(cls, v: str | None) -> str | None:
        """validate support url: empty, 'atprotofans', or https:// URL."""
        if v is None or v == "":
            return v  # let update logic handle clearing
        if v == ATPROTOFANS_MODE:
            return v
        if not v.startswith("https://"):
            raise ValueError(
                "support link must be 'atprotofans' or start with https://"
            )
        return v


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
        support_url=prefs.support_url,
        ui_settings=prefs.ui_settings or {},
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
            support_url=update.support_url,
            ui_settings=update.ui_settings or {},
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
        if update.support_url is not None:
            # allow clearing by setting to empty string
            prefs.support_url = update.support_url if update.support_url else None
        if update.ui_settings is not None:
            # merge with existing settings to allow partial updates
            prefs.ui_settings = {**(prefs.ui_settings or {}), **update.ui_settings}

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
        support_url=prefs.support_url,
        ui_settings=prefs.ui_settings or {},
    )

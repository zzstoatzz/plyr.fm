"""user preferences api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from relay._internal import Session, require_auth
from relay.models import UserPreferences, get_db

router = APIRouter(prefix="/preferences", tags=["preferences"])


class PreferencesResponse(BaseModel):
    """user preferences response model."""

    accent_color: str
    auto_advance: bool


class PreferencesUpdate(BaseModel):
    """user preferences update model."""

    accent_color: str | None = None
    auto_advance: bool | None = None


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
        prefs = UserPreferences(did=session.did, accent_color="#6a9fff")
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)

    return PreferencesResponse(
        accent_color=prefs.accent_color, auto_advance=prefs.auto_advance
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
        )
        db.add(prefs)
    else:
        # update existing
        if update.accent_color is not None:
            prefs.accent_color = update.accent_color
        if update.auto_advance is not None:
            prefs.auto_advance = update.auto_advance

    await db.commit()
    await db.refresh(prefs)

    return PreferencesResponse(
        accent_color=prefs.accent_color, auto_advance=prefs.auto_advance
    )

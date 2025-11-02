"""user preferences api endpoints."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from relay._internal import Session, require_auth
from relay.models import UserPreferences, get_db

router = APIRouter(prefix="/preferences", tags=["preferences"])


class PreferencesResponse(BaseModel):
    """user preferences response model."""

    accent_color: str


class PreferencesUpdate(BaseModel):
    """user preferences update model."""

    accent_color: str | None = None


@router.get("/")
async def get_preferences(
    db: DBSession = Depends(get_db),
    session: Session = Depends(require_auth),
) -> PreferencesResponse:
    """get user preferences (creates default if not exists)."""
    prefs = db.query(UserPreferences).filter(UserPreferences.did == session.did).first()

    if not prefs:
        # create default preferences
        prefs = UserPreferences(did=session.did, accent_color="#6a9fff")
        db.add(prefs)
        db.commit()
        db.refresh(prefs)

    return PreferencesResponse(accent_color=prefs.accent_color)


@router.post("/")
async def update_preferences(
    update: PreferencesUpdate,
    db: DBSession = Depends(get_db),
    session: Session = Depends(require_auth),
) -> PreferencesResponse:
    """update user preferences."""
    prefs = db.query(UserPreferences).filter(UserPreferences.did == session.did).first()

    if not prefs:
        # create new preferences
        prefs = UserPreferences(
            did=session.did, accent_color=update.accent_color or "#6a9fff"
        )
        db.add(prefs)
    else:
        # update existing
        if update.accent_color is not None:
            prefs.accent_color = update.accent_color

    db.commit()
    db.refresh(prefs)

    return PreferencesResponse(accent_color=prefs.accent_color)

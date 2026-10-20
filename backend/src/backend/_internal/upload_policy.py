"""Temporary account-specific pause on accepting and processing new audio."""

from fastapi import HTTPException
from sqlalchemy import select

from backend._internal.upload_notifications import schedule_upload_pause_notification
from backend.models import Track
from backend.utilities.database import db_session

PAUSED_UPLOAD_DIDS = frozenset({"did:plc:so3ysj7gypel6w7mixdfjhkh"})
UPLOAD_PAUSE_MESSAGE = (
    "thanks for using plyr.fm. i've temporarily paused new uploads on your account "
    "because processing this volume of audio is costing more than i can currently "
    "support. i'm sorry for the disruption while i work out a sustainable approach. "
    "your existing tracks are still available. please DM me on bluesky "
    "(@zzstoatzz.io) so we can talk."
)


def upload_pause_message(did: str) -> str | None:
    return UPLOAD_PAUSE_MESSAGE if did in PAUSED_UPLOAD_DIDS else None


async def require_upload_allowed(
    did: str, handle: str | None, event: str, detail: str = ""
) -> None:
    if message := upload_pause_message(did):
        await schedule_upload_pause_notification(did, handle, event, detail)
        raise HTTPException(status_code=403, detail=message)


async def track_uploads_paused(track_id: int) -> bool:
    async with db_session() as db:
        did = await db.scalar(select(Track.artist_did).where(Track.id == track_id))
    return did in PAUSED_UPLOAD_DIDS

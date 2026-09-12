"""Album templates and explicit application to existing tracks."""

from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.models import Album, Track, UserPreferences, get_db
from backend.utilities.publishing import PublishingDefaults

from .cache import invalidate_album_cache_by_id
from .router import router


class AlbumPublishingChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settings: PublishingDefaults | None
    replace_overrides: bool = False


class AlbumPublishingResponse(BaseModel):
    job_id: str
    selected_track_ids: list[int]
    preserved_track_ids: list[int]


@router.post("/{album_id}/publishing")
async def change_album_publishing(
    album_id: str,
    body: AlbumPublishingChange,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> AlbumPublishingResponse:
    # Track routes import album cache helpers during registration.
    from backend.api.tracks.publishing import queue_publishing_change

    album = await db.get(Album, album_id)
    if album is None or album.artist_did != session.did:
        raise HTTPException(status_code=404, detail="album not found")
    prefs = await db.get(UserPreferences, session.did)
    settings = body.settings or PublishingDefaults.model_validate(
        prefs.publishing_defaults if prefs else {}
    )
    if settings.access.visibility == "private" or settings.access.listening == "space":
        raise HTTPException(
            status_code=400, detail="private albums are not supported yet"
        )
    tracks = (await db.scalars(select(Track).where(Track.album_id == album.id))).all()
    selected = [
        track.id
        for track in tracks
        if body.replace_overrides or track.policy_origin != "track"
    ]
    preserved = [track.id for track in tracks if track.id not in selected]
    album.publishing_defaults = body.settings.model_dump() if body.settings else None
    await db.commit()
    await invalidate_album_cache_by_id(db, album.id)
    queued = await queue_publishing_change(
        session, selected, settings, "album" if body.settings else "portal"
    )
    return AlbumPublishingResponse(
        job_id=queued.job_id, selected_track_ids=selected, preserved_track_ids=preserved
    )

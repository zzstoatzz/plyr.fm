"""discovery endpoints — social graph powered artist discovery."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto.profile import normalize_avatar_url
from backend._internal.follow_graph import get_follows
from backend.models import Artist, Track, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discover", tags=["discover"])


class NetworkArtistResponse(BaseModel):
    """artist from your bluesky follow graph who has music on plyr.fm."""

    did: str
    handle: str
    display_name: str
    avatar_url: str | None
    track_count: int

    @field_validator("avatar_url", mode="before")
    @classmethod
    def normalize_avatar(cls, v: str | None) -> str | None:
        return normalize_avatar_url(v)


@router.get("/network")
async def get_network_artists(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Session = Depends(require_auth),
) -> list[NetworkArtistResponse]:
    """discover artists on plyr.fm that you follow on bluesky."""
    follow_dids = await get_follows(auth_session.did)
    if not follow_dids:
        return []

    # inner join ensures only artists with at least one track are returned
    result = await db.execute(
        select(Artist, func.count(Track.id).label("track_count"))
        .join(Track, Track.artist_did == Artist.did)
        .where(Artist.did.in_(follow_dids))
        .group_by(Artist.did)
    )

    artists = [
        NetworkArtistResponse(
            did=artist.did,
            handle=artist.handle,
            display_name=artist.display_name,
            avatar_url=follow_dids[artist.did].avatar_url or artist.avatar_url,
            track_count=track_count,
        )
        for artist, track_count in result.all()
    ]

    # sort by follow index DESC — oldest follows first ("people you know the most")
    artists.sort(key=lambda a: follow_dids[a.did].index, reverse=True)
    return artists

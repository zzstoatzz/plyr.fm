"""discovery endpoints — social graph powered artist discovery."""

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto.profile import BSKY_API_BASE, normalize_avatar_url
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


async def _get_follows(did: str) -> set[str]:
    """fetch all DIDs a user follows on bluesky (public API, no auth needed)."""
    follows: set[str] = set()
    cursor: str | None = None

    async with httpx.AsyncClient() as client:
        while True:
            params: dict[str, str | int] = {"actor": did, "limit": 100}
            if cursor:
                params["cursor"] = cursor

            resp = await client.get(
                f"{BSKY_API_BASE}/app.bsky.graph.getFollows",
                params=params,
                timeout=10.0,
            )
            if resp.status_code != 200:
                logger.warning(f"getFollows failed for {did}: {resp.status_code}")
                break

            data = resp.json()
            follows.update(f["did"] for f in data.get("follows", []))

            if not (cursor := data.get("cursor")):
                break

    return follows


@router.get("/network")
async def get_network_artists(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Session = Depends(require_auth),
) -> list[NetworkArtistResponse]:
    """discover artists on plyr.fm that you follow on bluesky."""
    follow_dids = await _get_follows(auth_session.did)
    if not follow_dids:
        return []

    # inner join ensures only artists with at least one track are returned
    result = await db.execute(
        select(Artist, func.count(Track.id).label("track_count"))
        .join(Track, Track.artist_did == Artist.did)
        .where(Artist.did.in_(follow_dids))
        .group_by(Artist.did)
        .order_by(func.count(Track.id).desc())
    )

    return [
        NetworkArtistResponse(
            did=artist.did,
            handle=artist.handle,
            display_name=artist.display_name,
            avatar_url=artist.avatar_url,
            track_count=track_count,
        )
        for artist, track_count in result.all()
    ]

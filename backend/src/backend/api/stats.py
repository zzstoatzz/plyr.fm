"""platform-wide statistics endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Track, get_db

router = APIRouter(prefix="/stats", tags=["stats"])


class PlatformStats(BaseModel):
    """platform-wide statistics."""

    total_plays: int
    total_tracks: int
    total_artists: int


@router.get("")
async def get_platform_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PlatformStats:
    """get platform-wide statistics."""
    result = await db.execute(
        select(
            func.coalesce(func.sum(Track.play_count), 0),
            func.count(Track.id),
            func.count(func.distinct(Track.artist_did)),
        )
    )
    row = result.one()

    return PlatformStats(
        total_plays=int(row[0]),
        total_tracks=int(row[1]),
        total_artists=int(row[2]),
    )

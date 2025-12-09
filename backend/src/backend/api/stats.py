"""platform-wide statistics endpoints."""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models import Track, get_db

router = APIRouter(prefix="/stats", tags=["stats"])


class PlatformStats(BaseModel):
    """platform-wide statistics."""

    total_plays: int
    total_tracks: int
    total_artists: int
    total_duration_seconds: int


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
            # sum duration from JSONB extra column (cast to int, coalesce nulls to 0)
            func.coalesce(
                func.sum(text("(extra->>'duration')::int")),
                0,
            ),
        )
    )
    row = result.one()

    return PlatformStats(
        total_plays=int(row[0]),
        total_tracks=int(row[1]),
        total_artists=int(row[2]),
        total_duration_seconds=int(row[3]),
    )


@router.get("/costs")
async def get_costs() -> Response:
    """proxy costs JSON from R2 to avoid CORS issues.

    the costs.json file is generated daily by a GitHub Action and uploaded
    to R2. this endpoint proxies it so the frontend can fetch without CORS.
    """
    costs_url = settings.storage.costs_json_url
    if not costs_url:
        raise HTTPException(status_code=404, detail="costs dashboard not configured")

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(costs_url, timeout=10)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502, detail=f"failed to fetch costs: {e}"
            ) from e

    return Response(
        content=resp.content,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=3600"},
    )

"""tag endpoints for track categorization."""

from typing import Annotated

from fastapi import Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Tag, TrackTag, get_db

from .router import router


class TagWithCount(BaseModel):
    """tag with track count for autocomplete."""

    name: str
    track_count: int


@router.get("/tags")
async def list_tags(
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str | None, Query(description="search query for tag names")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[TagWithCount]:
    """list tags with track counts, optionally filtered by query.

    returns tags sorted by track count (most used first).
    use `q` parameter for prefix search (case-insensitive).
    """
    # build query: tags with their track counts
    query = (
        select(Tag.name, func.count(TrackTag.track_id).label("track_count"))
        .outerjoin(TrackTag, Tag.id == TrackTag.tag_id)
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(TrackTag.track_id).desc(), Tag.name)
        .limit(limit)
    )

    # apply prefix filter if query provided
    if q:
        query = query.where(Tag.name.ilike(f"{q}%"))

    result = await db.execute(query)
    rows = result.all()

    return [TagWithCount(name=row.name, track_count=row.track_count) for row in rows]

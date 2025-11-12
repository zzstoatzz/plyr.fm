"""aggregation utilities for efficient batch counting."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import TrackLike


async def get_like_counts(db: AsyncSession, track_ids: list[int]) -> dict[int, int]:
    """get like counts for multiple tracks in a single query.

    args:
        db: database session
        track_ids: list of track IDs to get counts for

    returns:
        dict mapping track_id -> like_count (omits tracks with zero likes)
    """
    if not track_ids:
        return {}

    # single GROUP BY query with WHERE IN clause
    stmt = (
        select(TrackLike.track_id, func.count(TrackLike.id))
        .where(TrackLike.track_id.in_(track_ids))
        .group_by(TrackLike.track_id)
    )

    result = await db.execute(stmt)
    return dict(result.all())

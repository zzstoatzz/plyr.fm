"""aggregation utilities for efficient batch counting."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from backend.models import CopyrightScan, TrackComment, TrackLike


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
    return dict(result.all())  # type: ignore


async def get_comment_counts(db: AsyncSession, track_ids: list[int]) -> dict[int, int]:
    """get comment counts for multiple tracks in a single query.

    args:
        db: database session
        track_ids: list of track IDs to get counts for

    returns:
        dict mapping track_id -> comment_count (omits tracks with zero comments)
    """
    if not track_ids:
        return {}

    stmt = (
        select(TrackComment.track_id, func.count(TrackComment.id))
        .where(TrackComment.track_id.in_(track_ids))
        .group_by(TrackComment.track_id)
    )

    result = await db.execute(stmt)
    return dict(result.all())  # type: ignore


async def get_copyright_flags(
    db: AsyncSession, track_ids: list[int]
) -> dict[int, bool]:
    """get copyright flag status for multiple tracks in a single query.

    args:
        db: database session
        track_ids: list of track IDs to get flags for

    returns:
        dict mapping track_id -> is_flagged (only includes scanned tracks)
    """
    if not track_ids:
        return {}

    stmt = select(CopyrightScan.track_id, CopyrightScan.is_flagged).where(
        CopyrightScan.track_id.in_(track_ids)
    )

    result = await db.execute(stmt)
    return dict(result.all())  # type: ignore

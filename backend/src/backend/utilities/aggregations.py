"""aggregation utilities for efficient batch counting."""

from collections import Counter
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from backend.models import CopyrightScan, TrackComment, TrackLike


@dataclass
class CopyrightInfo:
    """copyright scan result with match details."""

    is_flagged: bool
    primary_match: str | None = None  # "Title by Artist" for most frequent match


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


async def get_copyright_info(
    db: AsyncSession, track_ids: list[int]
) -> dict[int, CopyrightInfo]:
    """get copyright scan info for multiple tracks in a single query.

    args:
        db: database session
        track_ids: list of track IDs to get info for

    returns:
        dict mapping track_id -> CopyrightInfo (only includes scanned tracks)
    """
    if not track_ids:
        return {}

    stmt = select(
        CopyrightScan.track_id, CopyrightScan.is_flagged, CopyrightScan.matches
    ).where(CopyrightScan.track_id.in_(track_ids))

    result = await db.execute(stmt)
    rows = result.all()

    copyright_info: dict[int, CopyrightInfo] = {}
    for track_id, is_flagged, matches in rows:
        primary_match = _extract_primary_match(matches) if is_flagged else None
        copyright_info[track_id] = CopyrightInfo(
            is_flagged=is_flagged,
            primary_match=primary_match,
        )

    return copyright_info


def _extract_primary_match(matches: list[dict[str, Any]]) -> str | None:
    """extract the most frequent match from copyright scan results.

    args:
        matches: list of match dicts with 'title' and 'artist' keys

    returns:
        "Title by Artist" string for the most common match, or None
    """
    if not matches:
        return None

    # count occurrences of each (title, artist) pair
    match_counts: Counter[tuple[str, str]] = Counter()
    for match in matches:
        title = match.get("title", "").strip()
        artist = match.get("artist", "").strip()
        if title and artist:
            match_counts[(title, artist)] += 1

    if not match_counts:
        return None

    # get the most common match
    (title, artist), _ = match_counts.most_common(1)[0]
    return f"{title} by {artist}"

"""aggregation utilities for efficient batch counting."""

import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from backend.models import (
    Artist,
    CopyrightScan,
    Tag,
    Track,
    TrackComment,
    TrackLike,
    TrackTag,
)

logger = logging.getLogger(__name__)


@dataclass
class CopyrightInfo:
    """copyright scan result with match details."""

    is_flagged: bool
    primary_match: str | None = None  # "Title by Artist" for most frequent match


class LikerPreview(BaseModel):
    """lightweight liker preview embedded in track responses.

    used to render the overlapping avatar stack next to a track's like count
    without a follow-up request. includes `liked_at` so the per-avatar hover
    tooltip can show "display name · 2h ago" without a follow-up fetch.

    defined here (alongside aggregation helpers) rather than in `schemas.py`
    to avoid a circular import: `schemas.py` imports from `aggregations.py`.
    """

    did: str
    handle: str
    display_name: str | None
    avatar_url: str | None
    liked_at: str


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


async def get_top_likers(
    db: AsyncSession,
    track_ids: list[int],
    limit: int = 5,
) -> dict[int, list[LikerPreview]]:
    """get the N most recent likers per track in a single batched query.

    uses ROW_NUMBER() OVER (PARTITION BY track_id ORDER BY created_at DESC) and
    filters to rn <= limit. postgres 15+ pushes the limit condition into the
    window aggregate (Run Condition), so work short-circuits once each track
    has N rows. EXPLAIN ANALYZE on production (308 likes, 20-track page):
    ~1ms execution, all in shared buffer cache.

    args:
        db: database session
        track_ids: list of track IDs to get likers for
        limit: max likers per track. default 5 — the frontend displays 3
            inline but only shows a "+N" expand tile when the overflow is
            meaningful (3+). returning 5 means tracks with 4 or 5 total
            likes can render everyone inline without the dead-end "+1"/"+2"
            affordance.

    returns:
        dict mapping track_id -> list of LikerPreview, most recent first.
        tracks with zero likes are omitted from the dict.
    """
    if not track_ids:
        return {}

    rn = (
        func.row_number()
        .over(
            partition_by=TrackLike.track_id,
            order_by=TrackLike.created_at.desc(),
        )
        .label("rn")
    )

    ranked = (
        select(
            Artist.did.label("did"),
            Artist.handle.label("handle"),
            Artist.display_name.label("display_name"),
            Artist.avatar_url.label("avatar_url"),
            TrackLike.track_id.label("track_id"),
            TrackLike.created_at.label("liked_at"),
            rn,
        )
        .join(Artist, Artist.did == TrackLike.user_did)
        .where(TrackLike.track_id.in_(track_ids))
        .subquery()
    )

    stmt = (
        select(
            ranked.c.did,
            ranked.c.handle,
            ranked.c.display_name,
            ranked.c.avatar_url,
            ranked.c.track_id,
            ranked.c.liked_at,
        )
        .where(ranked.c.rn <= limit)
        .order_by(ranked.c.track_id, ranked.c.rn)
    )

    result = await db.execute(stmt)
    out: dict[int, list[LikerPreview]] = defaultdict(list)
    for did, handle, display_name, avatar_url, track_id, liked_at in result.all():
        out[track_id].append(
            LikerPreview(
                did=did,
                handle=handle,
                display_name=display_name,
                avatar_url=avatar_url,
                liked_at=liked_at.isoformat(),
            )
        )
    return dict(out)


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
    return dict(result.all())


async def get_copyright_info(
    db: AsyncSession, track_ids: list[int]
) -> dict[int, CopyrightInfo]:
    """get copyright scan info for multiple tracks in a single query.

    this is a pure read - no reconciliation with the labeler.
    resolution sync happens via background task (sync_copyright_resolutions).

    args:
        db: database session
        track_ids: list of track IDs to get info for

    returns:
        dict mapping track_id -> CopyrightInfo (only includes scanned tracks)
    """
    if not track_ids:
        return {}

    stmt = select(
        CopyrightScan.track_id,
        CopyrightScan.is_flagged,
        CopyrightScan.matches,
    ).where(CopyrightScan.track_id.in_(track_ids))

    result = await db.execute(stmt)
    rows = result.all()

    copyright_info: dict[int, CopyrightInfo] = {}
    for track_id, is_flagged, matches in rows:
        copyright_info[track_id] = CopyrightInfo(
            is_flagged=is_flagged,
            primary_match=_extract_primary_match(matches) if is_flagged else None,
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


async def get_top_track_ids(db: AsyncSession, limit: int = 10) -> list[int]:
    """get track IDs ordered by like count (descending).

    args:
        db: database session
        limit: max number of track IDs to return

    returns:
        list of track IDs ordered by like count (most liked first)
    """
    stmt = (
        select(TrackLike.track_id)
        .group_by(TrackLike.track_id)
        .order_by(func.count(TrackLike.id).desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_top_tracks_with_counts(
    db: AsyncSession, limit: int = 10, since: datetime | None = None
) -> list[tuple[int, int]]:
    """get top track IDs with their like counts in a single query.

    combines the work of get_top_track_ids and get_like_counts to avoid
    a redundant DB round-trip (the GROUP BY already computes the count).

    args:
        db: database session
        limit: max number of tracks to return
        since: only count likes created at or after this time (None = all time)

    returns:
        list of (track_id, like_count) tuples ordered by like count descending
    """
    stmt = select(TrackLike.track_id, func.count(TrackLike.id).label("like_count"))
    if since is not None:
        stmt = stmt.where(TrackLike.created_at >= since)
    stmt = (
        stmt.group_by(TrackLike.track_id)
        .order_by(func.count(TrackLike.id).desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [(row[0], row[1]) for row in result.all()]


async def get_top_artists_by_plays(
    db: AsyncSession, limit: int = 10
) -> list[tuple[str, int]]:
    """get top artists ordered by total play count.

    args:
        db: database session
        limit: max number of artists to return

    returns:
        list of (artist_did, total_plays) tuples ordered by plays descending
    """
    stmt = (
        select(Track.artist_did, func.sum(Track.play_count).label("total_plays"))
        .where(Track.play_count > 0)
        .group_by(Track.artist_did)
        .order_by(func.sum(Track.play_count).desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [(row[0], row[1]) for row in result.all()]


async def get_track_tags(db: AsyncSession, track_ids: list[int]) -> dict[int, set[str]]:
    """get tags for multiple tracks in a single query.

    args:
        db: database session
        track_ids: list of track IDs to get tags for

    returns:
        dict mapping track_id -> set of tag names
    """
    if not track_ids:
        return {}

    stmt = (
        select(TrackTag.track_id, Tag.name)
        .join(Tag, TrackTag.tag_id == Tag.id)
        .where(TrackTag.track_id.in_(track_ids))
    )

    result = await db.execute(stmt)
    rows = result.all()

    # group tags by track_id
    tags_by_track: dict[int, set[str]] = {}
    for track_id, tag_name in rows:
        if track_id not in tags_by_track:
            tags_by_track[track_id] = set()
        tags_by_track[track_id].add(tag_name)

    return tags_by_track

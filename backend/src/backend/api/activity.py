"""activity feed — platform-wide chronological event stream."""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.profile import normalize_avatar_url
from backend.models import TrackPlay, get_db

logger = logging.getLogger(__name__)

# all-time starts here; records can carry creator-set dates from before plyr existed
PLYR_LAUNCH = datetime(2025, 10, 1, tzinfo=UTC)

router = APIRouter(prefix="/activity", tags=["activity"])


class ActivityActor(BaseModel):
    """actor who performed the activity."""

    did: str
    handle: str
    display_name: str
    avatar_url: str | None

    @field_validator("avatar_url", mode="before")
    @classmethod
    def normalize_avatar(cls, v: str | None) -> str | None:
        return normalize_avatar_url(v)


class ActivityTrack(BaseModel):
    """track referenced in an activity event."""

    id: int
    title: str
    artist_handle: str
    image_url: str | None
    thumbnail_url: str | None
    artist_avatar_url: str | None = None

    @field_validator("artist_avatar_url", mode="before")
    @classmethod
    def normalize_avatar(cls, v: str | None) -> str | None:
        return normalize_avatar_url(v)


class ActivityCollection(BaseModel):
    """collection referenced in an activity event."""

    type: Literal["playlist", "album"]
    id: str
    name: str
    image_url: str | None = None
    owner_handle: str
    slug: str | None = None  # albums only, for URL: /u/{handle}/album/{slug}


class ActivityEvent(BaseModel):
    """single activity event."""

    type: Literal[
        "like",
        "track",
        "comment",
        "join",
        "playlist_create",
        "album_release",
        "track_added_to_playlist",
    ]
    actor: ActivityActor
    track: ActivityTrack | None = None
    comment_text: str | None = None
    collection: ActivityCollection | None = None
    created_at: datetime


class ActivityFeedResponse(BaseModel):
    """paginated activity feed."""

    events: list[ActivityEvent]
    next_cursor: str | None = None
    has_more: bool = False


class ActivityHistogramBucket(BaseModel):
    """one UTC time bucket in the activity histogram."""

    date: str
    count: int


class ActivityHistogramResponse(BaseModel):
    """activity counts over a time window."""

    buckets: list[ActivityHistogramBucket]
    interval: Literal["hour", "day", "month"] = "day"
    series: Literal["activity", "plays"] = "activity"
    tracked_since: datetime | None = None


# raw SQL for the UNION ALL query — each branch selects the same column shape
_BASE_COLUMNS = """
    a.did AS actor_did,
    a.handle AS actor_handle,
    a.display_name AS actor_display_name,
    a.avatar_url AS actor_avatar_url
"""

_TRACK_COLUMNS = """
    t.id AS track_id,
    t.title AS track_title,
    ta.handle AS track_artist_handle,
    t.image_url AS track_image_url,
    t.thumbnail_url AS track_thumbnail_url,
    ta.avatar_url AS track_artist_avatar_url
"""

_NULL_COLLECTION_COLUMNS = """
    NULL AS collection_type,
    NULL AS collection_id,
    NULL AS collection_name,
    NULL AS collection_image_url,
    NULL AS collection_owner_handle,
    NULL AS collection_slug
"""

_LIKE_QUERY = f"""
    (SELECT 'like' AS event_type,
        {_BASE_COLUMNS},
        {_TRACK_COLUMNS},
        NULL AS comment_text,
        {_NULL_COLLECTION_COLUMNS},
        tl.created_at AS created_at
    FROM track_likes tl
    JOIN artists a ON a.did = tl.user_did
    JOIN tracks t ON t.id = tl.track_id
    JOIN artists ta ON ta.did = t.artist_did
    {{cursor_clause}}
    ORDER BY tl.created_at DESC LIMIT :limit)
"""

_TRACK_QUERY = f"""
    (SELECT 'track' AS event_type,
        {_BASE_COLUMNS},
        t.id AS track_id,
        t.title AS track_title,
        a.handle AS track_artist_handle,
        t.image_url AS track_image_url,
        t.thumbnail_url AS track_thumbnail_url,
        a.avatar_url AS track_artist_avatar_url,
        NULL AS comment_text,
        {_NULL_COLLECTION_COLUMNS},
        t.created_at AS created_at
    FROM tracks t
    JOIN artists a ON a.did = t.artist_did
    {{cursor_clause}}
    ORDER BY t.created_at DESC LIMIT :limit)
"""

_COMMENT_QUERY = f"""
    (SELECT 'comment' AS event_type,
        {_BASE_COLUMNS},
        {_TRACK_COLUMNS},
        tc.text AS comment_text,
        {_NULL_COLLECTION_COLUMNS},
        tc.created_at AS created_at
    FROM track_comments tc
    JOIN artists a ON a.did = tc.user_did
    JOIN tracks t ON t.id = tc.track_id
    JOIN artists ta ON ta.did = t.artist_did
    {{cursor_clause}}
    ORDER BY tc.created_at DESC LIMIT :limit)
"""

_JOIN_QUERY = f"""
    (SELECT 'join' AS event_type,
        {_BASE_COLUMNS},
        NULL::integer AS track_id,
        NULL AS track_title,
        NULL AS track_artist_handle,
        NULL AS track_image_url,
        NULL AS track_thumbnail_url,
        NULL AS track_artist_avatar_url,
        NULL AS comment_text,
        {_NULL_COLLECTION_COLUMNS},
        a.created_at AS created_at
    FROM artists a
    WHERE a.handle != '' AND a.display_name != ''
    {{cursor_clause}}
    ORDER BY a.created_at DESC LIMIT :limit)
"""

_COLLECTION_QUERY = f"""
    (SELECT ce.event_type AS event_type,
        {_BASE_COLUMNS},
        t.id AS track_id,
        t.title AS track_title,
        ta.handle AS track_artist_handle,
        t.image_url AS track_image_url,
        t.thumbnail_url AS track_thumbnail_url,
        ta.avatar_url AS track_artist_avatar_url,
        NULL AS comment_text,
        CASE WHEN ce.playlist_id IS NOT NULL THEN 'playlist'
             WHEN ce.album_id IS NOT NULL THEN 'album' END AS collection_type,
        COALESCE(p.id, al.id) AS collection_id,
        COALESCE(p.name, al.title) AS collection_name,
        COALESCE(p.image_url, al.image_url) AS collection_image_url,
        COALESCE(pa.handle, ala.handle) AS collection_owner_handle,
        al.slug AS collection_slug,
        ce.created_at AS created_at
    FROM collection_events ce
    JOIN artists a ON a.did = ce.actor_did
    LEFT JOIN playlists p ON p.id = ce.playlist_id
    LEFT JOIN artists pa ON pa.did = p.owner_did
    LEFT JOIN albums al ON al.id = ce.album_id
    LEFT JOIN artists ala ON ala.did = al.artist_did
    LEFT JOIN tracks t ON t.id = ce.track_id
    LEFT JOIN artists ta ON ta.did = t.artist_did
    -- defense-in-depth: never surface activity tied to a private playlist,
    -- even if a CollectionEvent for one accidentally exists. callers don't
    -- emit events for private playlists, but rely on this filter too.
    WHERE (ce.playlist_id IS NULL OR p.is_private = false)
    {{cursor_clause}}
    ORDER BY ce.created_at DESC LIMIT :limit)
"""


def _build_query(cursor: datetime | None) -> str:
    """build the UNION ALL query, conditionally including cursor filter.

    each branch has its own ORDER BY + LIMIT so postgres can index-scan
    the top N from each table independently, rather than materializing
    all qualifying rows before sorting.
    """
    if cursor:
        like_clause = "WHERE tl.created_at < :cursor"
        track_clause = "WHERE t.created_at < :cursor"
        comment_clause = "WHERE tc.created_at < :cursor"
        join_clause = "AND a.created_at < :cursor"
        collection_clause = "AND ce.created_at < :cursor"
    else:
        like_clause = ""
        track_clause = ""
        comment_clause = ""
        join_clause = ""
        collection_clause = ""

    parts = [
        _LIKE_QUERY.format(cursor_clause=like_clause),
        _TRACK_QUERY.format(cursor_clause=track_clause),
        _COMMENT_QUERY.format(cursor_clause=comment_clause),
        _JOIN_QUERY.format(cursor_clause=join_clause),
        _COLLECTION_QUERY.format(cursor_clause=collection_clause),
    ]

    return " UNION ALL ".join(parts) + " ORDER BY created_at DESC LIMIT :limit"


@router.get("/")
async def get_activity_feed(
    db: Annotated[AsyncSession, Depends(get_db)],
    cursor: str | None = Query(None),
    limit: int = Query(20),
) -> ActivityFeedResponse:
    """get the platform-wide activity feed."""
    limit = max(1, min(limit, 100))

    cursor_time: datetime | None = None
    if cursor:
        try:
            cursor_time = datetime.fromisoformat(cursor)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid cursor format") from e

    query = _build_query(cursor_time)
    params: dict[str, object] = {"limit": limit + 1}
    if cursor_time:
        params["cursor"] = cursor_time

    result = await db.execute(text(query), params)
    rows = result.fetchall()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    events: list[ActivityEvent] = []
    for row in rows:
        collection: ActivityCollection | None = None
        if row.collection_type and row.collection_id:
            collection = ActivityCollection(
                type=row.collection_type,
                id=row.collection_id,
                name=row.collection_name or "",
                image_url=row.collection_image_url,
                owner_handle=row.collection_owner_handle or "",
                slug=row.collection_slug,
            )

        events.append(
            ActivityEvent(
                type=row.event_type,
                actor=ActivityActor(
                    did=row.actor_did,
                    handle=row.actor_handle,
                    display_name=row.actor_display_name,
                    avatar_url=row.actor_avatar_url,
                ),
                track=ActivityTrack(
                    id=row.track_id,
                    title=row.track_title,
                    artist_handle=row.track_artist_handle,
                    image_url=row.track_image_url,
                    thumbnail_url=row.track_thumbnail_url,
                    artist_avatar_url=row.track_artist_avatar_url,
                )
                if row.track_id is not None
                else None,
                comment_text=row.comment_text,
                collection=collection,
                created_at=row.created_at,
            )
        )

    next_cursor = events[-1].created_at.isoformat() if has_more and events else None

    return ActivityFeedResponse(
        events=events,
        next_cursor=next_cursor,
        has_more=has_more,
    )


_ACTIVITY_EVENTS = """
        SELECT tl.created_at FROM track_likes tl
            WHERE tl.created_at >= COALESCE(CAST(:start AS timestamptz), '-infinity')
                AND tl.created_at <= :now
        UNION ALL
        SELECT t.created_at FROM tracks t
            WHERE t.created_at >= COALESCE(CAST(:start AS timestamptz), '-infinity')
                AND t.created_at <= :now
        UNION ALL
        SELECT tc.created_at FROM track_comments tc
            WHERE tc.created_at >= COALESCE(CAST(:start AS timestamptz), '-infinity')
                AND tc.created_at <= :now
        UNION ALL
        SELECT a.created_at FROM artists a
            WHERE a.handle != '' AND a.display_name != ''
                AND a.created_at >= COALESCE(CAST(:start AS timestamptz), '-infinity')
                AND a.created_at <= :now
        UNION ALL
        SELECT ce.created_at FROM collection_events ce
            JOIN artists a ON a.did = ce.actor_did
            LEFT JOIN playlists p ON p.id = ce.playlist_id
            WHERE (ce.playlist_id IS NULL OR p.is_private = false)
                AND ce.created_at >= COALESCE(CAST(:start AS timestamptz), '-infinity')
                AND ce.created_at <= :now
"""

_PLAY_EVENTS = """
        SELECT tp.played_at AS created_at FROM track_plays tp
            WHERE tp.played_at >= COALESCE(CAST(:start AS timestamptz), '-infinity')
                AND tp.played_at <= :now
                AND (tp.source != 'teal' OR tp.played_at < COALESCE(
                    (SELECT MIN(played_at) FROM track_plays WHERE source != 'teal'),
                    'infinity'))
"""

_HISTOGRAM_QUERY = """
    WITH events AS ({events}
    ), counts AS (
        SELECT date_trunc(:interval, created_at AT TIME ZONE 'UTC') AS bucket,
            COUNT(*) AS total
        FROM events GROUP BY bucket
    )
    SELECT d AS bucket_date, COALESCE(c.total, 0) AS total
    FROM generate_series(
        date_trunc(:interval,
            COALESCE(CAST(:start AS timestamptz),
                (SELECT MIN(created_at) FROM events), :now) AT TIME ZONE 'UTC'),
        date_trunc(:interval, CAST(:now AS timestamptz) AT TIME ZONE 'UTC'),
        CAST(CAST(:step AS text) AS interval)
    ) d
    LEFT JOIN counts c ON c.bucket = d
    ORDER BY bucket_date
"""


@router.get("/histogram")
async def get_activity_histogram(
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(7, ge=1, le=30),
    range: Literal["day", "week", "month", "year", "all"] | None = Query(None),
    series: Literal["activity", "plays"] = Query("activity"),
) -> ActivityHistogramResponse:
    """get zero-filled counts; named ranges take precedence over days.

    `series=plays` counts recorded plays; `tracked_since` marks where plays
    stop being teal-only backfill.
    """
    now = datetime.now(UTC)
    interval: Literal["hour", "day", "month"] = "day"
    start: datetime | None
    if range in ("day", "week"):
        interval = "hour"
        hours = 24 if range == "day" else 168
        start = now.replace(minute=0, second=0, microsecond=0) - timedelta(
            hours=hours - 1
        )
    elif range == "all":
        interval = "month"
        start = PLYR_LAUNCH
    else:
        day_count = {"month": 30, "year": 365}.get(range, days)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
            days=day_count - 1
        )

    events = _PLAY_EVENTS if series == "plays" else _ACTIVITY_EVENTS
    result = await db.execute(
        text(_HISTOGRAM_QUERY.format(events=events)),
        {"start": start, "now": now, "interval": interval, "step": f"1 {interval}"},
    )
    tracked_since = (
        await db.scalar(
            select(func.min(TrackPlay.played_at)).where(TrackPlay.source != "teal")
        )
        if series == "plays"
        else None
    )

    return ActivityHistogramResponse(
        buckets=[
            ActivityHistogramBucket(
                date=row.bucket_date.date().isoformat()
                if interval == "day"
                else row.bucket_date.replace(tzinfo=UTC).isoformat(),
                count=row.total,
            )
            for row in result.fetchall()
        ],
        interval=interval,
        series=series,
        tracked_since=tracked_since,
    )

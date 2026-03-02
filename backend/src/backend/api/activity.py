"""activity feed — platform-wide chronological event stream."""

import logging
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.profile import normalize_avatar_url
from backend.models import get_db

logger = logging.getLogger(__name__)

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


class ActivityEvent(BaseModel):
    """single activity event."""

    type: Literal["like", "track", "comment", "join"]
    actor: ActivityActor
    track: ActivityTrack | None = None
    comment_text: str | None = None
    created_at: datetime


class ActivityFeedResponse(BaseModel):
    """paginated activity feed."""

    events: list[ActivityEvent]
    next_cursor: str | None = None
    has_more: bool = False


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
    t.thumbnail_url AS track_thumbnail_url
"""

_LIKE_QUERY = f"""
    (SELECT 'like' AS event_type,
        {_BASE_COLUMNS},
        {_TRACK_COLUMNS},
        NULL AS comment_text,
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
        NULL AS comment_text,
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
        NULL AS comment_text,
        a.created_at AS created_at
    FROM artists a
    WHERE a.handle != '' AND a.display_name != ''
    {{cursor_clause}}
    ORDER BY a.created_at DESC LIMIT :limit)
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
    else:
        like_clause = ""
        track_clause = ""
        comment_clause = ""
        join_clause = ""

    parts = [
        _LIKE_QUERY.format(cursor_clause=like_clause),
        _TRACK_QUERY.format(cursor_clause=track_clause),
        _COMMENT_QUERY.format(cursor_clause=comment_clause),
        _JOIN_QUERY.format(cursor_clause=join_clause),
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

    events = [
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
            )
            if row.track_id is not None
            else None,
            comment_text=row.comment_text,
            created_at=row.created_at,
        )
        for row in rows
    ]

    next_cursor = events[-1].created_at.isoformat() if has_more and events else None

    return ActivityFeedResponse(
        events=events,
        next_cursor=next_cursor,
        has_more=has_more,
    )

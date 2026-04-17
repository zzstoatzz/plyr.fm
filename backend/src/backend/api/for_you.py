"""For You feed — collaborative filtering over user engagement edges.

Ports the scoring algorithm from grain.social's foryou.ts (originally tuned
by @spacecowboy17.bsky.social), adapted for plyr.fm in two ways:

1. **edges are not just likes**: a user "engages" with a track via a like OR
   a track_added_to_playlist event. both edges get weight 1.0 for v1.
2. **slower time decay**: audio ages slower than photo galleries, so we use
   a 48h half-life (grain uses 6h).

Scoring recipe per candidate track:
    score = (sum over paths of 1 / total_edges(coengager) ** DIVISOR_POWER)
            * paths ** SMOOTHING_FACTOR
            * 0.5 ** (age_hours / HALF_LIFE_HOURS)
            / popularity ** POPULARITY_PENALTY

Final output diversifies by artist (MAX_PER_ARTIST hard cap).
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

import logfire
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_supported_artists, require_auth
from backend.models import (
    Artist,
    Tag,
    Track,
    TrackLike,
    TrackTag,
    UserPreferences,
    get_db,
)
from backend.schemas import TrackResponse
from backend.utilities.aggregations import (
    get_comment_counts,
    get_like_counts,
    get_top_likers,
    get_track_tags,
)
from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/for-you", tags=["for-you"])


# ─── scoring parameters ─────────────────────────────────────────────
HALF_LIFE_HOURS = 48.0
SMOOTHING_FACTOR = 0.5
POPULARITY_PENALTY = 0.3
DIVISOR_POWER = 1.0
TIME_SHIFT_HOURS = 24
SEED_LIMIT = 500
MAX_COENGAGERS = 1000
MAX_PER_ARTIST = 2
COLD_START_WINDOW_DAYS = 30


# unified engagement edge: like OR playlist-add. both are strong taste signals.
# expressed as a SQL fragment substituted into each query below.
_EDGES_SQL = """
    SELECT user_did AS did, track_id, created_at
    FROM track_likes
    UNION ALL
    SELECT actor_did AS did, track_id, created_at
    FROM collection_events
    WHERE event_type = 'track_added_to_playlist' AND track_id IS NOT NULL
"""


_SEED_QUERY = text(f"""
    SELECT e.track_id, MAX(e.created_at) AS engaged_at
    FROM ({_EDGES_SQL}) e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.did = :actor AND t.artist_did != :actor
    GROUP BY e.track_id
    ORDER BY engaged_at DESC
    LIMIT :seed_limit
""")

_COENGAGER_QUERY = text(f"""
    SELECT e.did AS coengager, e.track_id, e.created_at
    FROM ({_EDGES_SQL}) e
    WHERE e.track_id = ANY(:seed_ids) AND e.did != :actor
""")

_COENGAGER_TOTALS_QUERY = text(f"""
    SELECT did, COUNT(*) AS cnt
    FROM ({_EDGES_SQL}) e
    WHERE did = ANY(:coengager_list)
    GROUP BY did
""")

_CANDIDATES_QUERY = text(f"""
    SELECT e.did AS coengager, e.track_id, t.created_at AS track_created_at,
           t.artist_did
    FROM ({_EDGES_SQL}) e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.did = ANY(:coengager_list)
      AND NOT (e.track_id = ANY(:seed_ids))
      AND t.artist_did != :actor
""")

_POPULARITY_QUERY = text(f"""
    SELECT e.track_id, COUNT(*) AS cnt
    FROM ({_EDGES_SQL}) e
    WHERE e.track_id = ANY(:candidate_ids)
    GROUP BY e.track_id
""")

_COLD_START_QUERY = text(f"""
    SELECT e.track_id, COUNT(*) AS cnt
    FROM ({_EDGES_SQL}) e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.created_at > :since AND t.artist_did != :actor
    GROUP BY e.track_id
    ORDER BY cnt DESC
    LIMIT :limit
""")


class ForYouResponse(BaseModel):
    """Paginated For You feed."""

    tracks: list[TrackResponse]
    next_cursor: str | None = None
    has_more: bool = False
    cold_start: bool = False


async def _score_candidates(
    db: AsyncSession, actor_did: str
) -> list[tuple[int, float]]:
    """Run the collaborative-filtering pipeline and return scored track ids.

    Returns a list of (track_id, score) sorted by score descending. May be
    empty if the user has no seeds or no co-engagers — caller should fall
    back to cold start.
    """
    # step 1: seeds = user's recent engagement edges (excluding self-uploads)
    seed_rows = (
        await db.execute(_SEED_QUERY, {"actor": actor_did, "seed_limit": SEED_LIMIT})
    ).all()
    if not seed_rows:
        return []

    seed_ids = [r.track_id for r in seed_rows]
    seed_engaged_time: dict[int, float] = {
        r.track_id: r.engaged_at.timestamp() for r in seed_rows
    }

    # step 2: co-engagers = other users who engaged with the same tracks.
    # only trust those who engaged BEFORE us (+ 24h grace) — grain's key insight.
    coengager_rows = (
        await db.execute(_COENGAGER_QUERY, {"actor": actor_did, "seed_ids": seed_ids})
    ).all()

    valid_coengagers: set[str] = set()
    coengager_overlap: dict[str, int] = {}
    grace = TIME_SHIFT_HOURS * 3600
    for row in coengager_rows:
        user_t = seed_engaged_time.get(row.track_id)
        if user_t is None:
            continue
        if row.created_at.timestamp() > user_t + grace:
            continue
        valid_coengagers.add(row.coengager)
        coengager_overlap[row.coengager] = coengager_overlap.get(row.coengager, 0) + 1

    if not valid_coengagers:
        return []

    # cap co-engagers, preferring those with more overlap with our seeds
    coengager_list = sorted(
        valid_coengagers, key=lambda d: coengager_overlap[d], reverse=True
    )[:MAX_COENGAGERS]

    # step 3: fetch candidates + co-engager totals in parallel
    candidate_task = db.execute(
        _CANDIDATES_QUERY,
        {
            "actor": actor_did,
            "coengager_list": coengager_list,
            "seed_ids": seed_ids,
        },
    )
    totals_task = db.execute(
        _COENGAGER_TOTALS_QUERY, {"coengager_list": coengager_list}
    )
    candidate_result, totals_result = await asyncio.gather(candidate_task, totals_task)
    candidate_rows = candidate_result.all()
    coengager_total_edges = {r.did: int(r.cnt) for r in totals_result.all()}

    if not candidate_rows:
        return []

    # step 4: score candidates
    now = datetime.now(UTC).timestamp()
    scores: dict[int, float] = {}
    paths: dict[int, int] = {}
    track_created: dict[int, float] = {}

    for row in candidate_rows:
        tid = row.track_id
        total = coengager_total_edges.get(row.coengager, 1) or 1
        path_score = 1.0 / (total**DIVISOR_POWER)
        scores[tid] = scores.get(tid, 0.0) + path_score
        paths[tid] = paths.get(tid, 0) + 1
        if tid not in track_created:
            track_created[tid] = row.track_created_at.timestamp()

    candidate_ids = list(scores.keys())
    popularity_rows = (
        await db.execute(_POPULARITY_QUERY, {"candidate_ids": candidate_ids})
    ).all()
    popularity = {r.track_id: int(r.cnt) for r in popularity_rows}

    # apply smoothing, time decay, popularity penalty
    final: list[tuple[int, float]] = []
    for tid, raw in scores.items():
        score = raw * (paths[tid] ** SMOOTHING_FACTOR)
        age_h = max(0.0, (now - track_created[tid]) / 3600.0)
        score *= 0.5 ** (age_h / HALF_LIFE_HOURS)
        pop = popularity.get(tid, 1) or 1
        score /= pop**POPULARITY_PENALTY
        final.append((tid, score))

    final.sort(key=lambda p: p[1], reverse=True)
    return final


async def _cold_start_ids(db: AsyncSession, actor_did: str, limit: int) -> list[int]:
    """Fallback ranking when a user has no seeds: most-engaged in last 30d."""
    since = datetime.now(UTC) - timedelta(days=COLD_START_WINDOW_DAYS)
    rows = (
        await db.execute(
            _COLD_START_QUERY, {"actor": actor_did, "since": since, "limit": limit}
        )
    ).all()
    return [r.track_id for r in rows]


def _diversify_by_artist(
    ranked: list[tuple[int, float]],
    artist_by_track: dict[int, str],
    max_per_artist: int,
) -> list[int]:
    """Walk the ranked list and enforce a hard per-artist cap."""
    counts: dict[str, int] = {}
    out: list[int] = []
    for tid, _score in ranked:
        artist = artist_by_track.get(tid)
        if artist is None:
            continue
        if counts.get(artist, 0) >= max_per_artist:
            continue
        out.append(tid)
        counts[artist] = counts.get(artist, 0) + 1
    return out


@router.get("/")
async def get_for_you_feed(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
    cursor: str | None = Query(None),
    limit: int = Query(30, ge=1, le=50),
    tags: list[str] | None = Query(None),
) -> ForYouResponse:
    """Personalized feed for the authenticated user.

    Uses collaborative filtering over engagement edges (likes + playlist adds).
    Falls back to cold-start (most-engaged last 30 days) if the user has no
    taste signal yet.

    Cursor is an integer offset into the materialized ranked list. Scores may
    drift between pages — this is fine for v1; if it becomes annoying we can
    cache the ranked list per-user in Redis.
    """
    actor_did = auth_session.did
    offset = 0
    if cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            offset = 0

    # generous over-fetch so the diversification and hidden-tag filter leave
    # us with enough to fill the page
    fetch_limit = (offset + limit) * 3

    with logfire.span("for_you score", actor=actor_did):
        ranked = await _score_candidates(db, actor_did)

    cold_start = False
    track_ids: list[int]
    if ranked:
        # need artist_did for diversification — fetch it once for the top-N
        top_slice = ranked[: fetch_limit * 2]
        top_ids = [tid for tid, _ in top_slice]
        artist_rows = (
            await db.execute(
                select(Track.id, Track.artist_did).where(
                    Track.id.in_(top_ids),
                    Track.unlisted == False,  # noqa: E712
                )
            )
        ).all()
        artist_by_track = {row.id: row.artist_did for row in artist_rows}
        track_ids = _diversify_by_artist(top_slice, artist_by_track, MAX_PER_ARTIST)
    else:
        cold_start = True
        track_ids = await _cold_start_ids(db, actor_did, fetch_limit)

    # apply hidden-tag preference + page window
    hidden_tags: list[str] = list(DEFAULT_HIDDEN_TAGS)
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == actor_did)
    )
    prefs = prefs_result.scalar_one_or_none()
    if prefs and prefs.hidden_tags is not None:
        hidden_tags = prefs.hidden_tags

    if hidden_tags and track_ids:
        hidden_rows = (
            await db.execute(
                select(TrackTag.track_id)
                .join(Tag, TrackTag.tag_id == Tag.id)
                .where(Tag.name.in_(hidden_tags))
                .where(TrackTag.track_id.in_(track_ids))
            )
        ).all()
        hidden_set = {r.track_id for r in hidden_rows}
        if hidden_set:
            track_ids = [tid for tid in track_ids if tid not in hidden_set]

    # apply active tag filter (inclusive — keep only tracks with at least one matching tag)
    if tags and track_ids:
        tagged_rows = (
            await db.execute(
                select(TrackTag.track_id)
                .join(Tag, TrackTag.tag_id == Tag.id)
                .where(Tag.name.in_(tags))
                .where(TrackTag.track_id.in_(track_ids))
            )
        ).all()
        tagged_set = {r.track_id for r in tagged_rows}
        track_ids = [tid for tid in track_ids if tid in tagged_set]

    # page window
    page_ids = track_ids[offset : offset + limit]
    has_more = len(track_ids) > offset + limit
    next_cursor = str(offset + limit) if has_more else None

    if not page_ids:
        return ForYouResponse(
            tracks=[], next_cursor=None, has_more=False, cold_start=cold_start
        )

    # step 5: hydrate Track rows (preserve ranking order)
    track_result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.id.in_(page_ids))
    )
    tracks_by_id = {t.id: t for t in track_result.scalars().all()}
    tracks = [tracks_by_id[tid] for tid in page_ids if tid in tracks_by_id]

    # step 6: batch aggregations + liked set + supporter status (mirrors /tracks/)
    liked_result = await db.execute(
        select(TrackLike.track_id).where(
            TrackLike.user_did == actor_did,
            TrackLike.track_id.in_(page_ids),
        )
    )
    liked_track_ids = set(liked_result.scalars().all())

    like_counts, comment_counts, track_tags, top_likers = await asyncio.gather(
        get_like_counts(db, page_ids),
        get_comment_counts(db, page_ids),
        get_track_tags(db, page_ids),
        get_top_likers(db, page_ids),
    )

    gated_artist_dids = {
        t.artist_did for t in tracks if t.support_gate and t.artist_did != actor_did
    }
    supported_artist_dids: set[str] = set()
    if gated_artist_dids:
        supported_artist_dids = await get_supported_artists(
            actor_did, gated_artist_dids
        )

    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                t,
                liked_track_ids=liked_track_ids,
                like_counts=like_counts,
                comment_counts=comment_counts,
                track_tags=track_tags,
                top_likers=top_likers,
                viewer_did=actor_did,
                supported_artist_dids=supported_artist_dids,
            )
            for t in tracks
        ]
    )

    return ForYouResponse(
        tracks=list(track_responses),
        next_cursor=next_cursor,
        has_more=has_more,
        cold_start=cold_start,
    )

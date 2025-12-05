"""aggregation utilities for efficient batch counting."""

import logging
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from backend.models import CopyrightScan, Tag, Track, TrackComment, TrackLike, TrackTag

logger = logging.getLogger(__name__)


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

    checks the moderation service's labeler for the true resolution status.
    if a track was resolved (negation label exists), treats it as not flagged
    and lazily updates the backend's resolution field.

    args:
        db: database session
        track_ids: list of track IDs to get info for

    returns:
        dict mapping track_id -> CopyrightInfo (only includes scanned tracks)
    """
    if not track_ids:
        return {}

    # get scans with track AT URIs for labeler lookup
    stmt = (
        select(
            CopyrightScan.id,
            CopyrightScan.track_id,
            CopyrightScan.is_flagged,
            CopyrightScan.matches,
            CopyrightScan.resolution,
            Track.atproto_record_uri,
        )
        .join(Track, CopyrightScan.track_id == Track.id)
        .where(CopyrightScan.track_id.in_(track_ids))
    )

    result = await db.execute(stmt)
    rows = result.all()

    # separate flagged scans that need labeler check vs already resolved
    needs_labeler_check: list[
        tuple[int, int, str, list]
    ] = []  # scan_id, track_id, uri, matches
    copyright_info: dict[int, CopyrightInfo] = {}

    for scan_id, track_id, is_flagged, matches, resolution, uri in rows:
        if not is_flagged or resolution is not None:
            # not flagged or already resolved - no need to check labeler
            copyright_info[track_id] = CopyrightInfo(
                is_flagged=False if resolution else is_flagged,
                primary_match=_extract_primary_match(matches)
                if is_flagged and not resolution
                else None,
            )
        elif uri:
            # flagged with no resolution - need to check labeler
            needs_labeler_check.append((scan_id, track_id, uri, matches))
        else:
            # flagged but no AT URI - can't check labeler, treat as flagged
            copyright_info[track_id] = CopyrightInfo(
                is_flagged=True,
                primary_match=_extract_primary_match(matches),
            )

    # check labeler for tracks that need it
    if needs_labeler_check:
        from backend._internal.moderation import get_active_copyright_labels

        uris = [uri for _, _, uri, _ in needs_labeler_check]
        active_uris = await get_active_copyright_labels(uris)

        # process results and lazily update DB for resolved tracks
        resolved_scan_ids: list[int] = []
        for scan_id, track_id, uri, matches in needs_labeler_check:
            if uri in active_uris:
                # still actively flagged
                copyright_info[track_id] = CopyrightInfo(
                    is_flagged=True,
                    primary_match=_extract_primary_match(matches),
                )
            else:
                # resolved in labeler - treat as not flagged
                copyright_info[track_id] = CopyrightInfo(
                    is_flagged=False,
                    primary_match=None,
                )
                resolved_scan_ids.append(scan_id)

        # lazily update resolution for newly discovered resolved scans
        if resolved_scan_ids:
            try:
                await db.execute(
                    update(CopyrightScan)
                    .where(CopyrightScan.id.in_(resolved_scan_ids))
                    .values(resolution="dismissed", reviewed_at=datetime.now(UTC))
                )
                await db.commit()
                logger.info(
                    "lazily updated %d copyright scans as dismissed",
                    len(resolved_scan_ids),
                )
            except Exception as e:
                logger.warning("failed to lazily update copyright resolutions: %s", e)
                await db.rollback()

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

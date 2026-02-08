"""tag normalization and management utilities."""

import re
from datetime import UTC, datetime
from typing import Annotated

import logfire
from pydantic import Field, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

# tags that are hidden by default for new users
DEFAULT_HIDDEN_TAGS: list[str] = ["ai"]

# tag validation constraints
MAX_TAG_LENGTH = 50
MAX_TAGS_PER_TRACK = 10

# pydantic type adapter for parsing JSON tag arrays
TagList = TypeAdapter(list[Annotated[str, Field(max_length=MAX_TAG_LENGTH)]])


def parse_tags_json(tags_json: str | None) -> list[str]:
    """parse and normalize a JSON array of tag names.

    args:
        tags_json: JSON string containing array of tag names, or None

    returns:
        list of normalized, deduplicated tag names

    raises:
        ValueError: if tags_json is malformed or exceeds limits
    """
    if not tags_json:
        return []

    try:
        tag_names = TagList.validate_json(tags_json)
    except ValidationError as e:
        raise ValueError(f"invalid tags: {e}") from e

    # normalize and deduplicate
    seen: set[str] = set()
    unique: list[str] = []
    for tag in tag_names:
        normalized = normalize_tag(tag)
        if normalized and normalized not in seen:
            seen.add(normalized)
            unique.append(normalized)

    if len(unique) > MAX_TAGS_PER_TRACK:
        raise ValueError(f"too many tags: {len(unique)} (maximum {MAX_TAGS_PER_TRACK})")

    return unique


def normalize_tag(tag: str) -> str:
    """normalize a tag name to canonical form.

    - strips whitespace
    - converts to lowercase
    - collapses multiple spaces to single space
    - removes leading/trailing hyphens

    examples:
        "  AI  Generated " -> "ai generated"
        "Hip-Hop" -> "hip-hop"
        "  test  " -> "test"
    """
    if not tag:
        return ""

    # strip and lowercase
    normalized = tag.strip().lower()

    # collapse multiple spaces to single space
    normalized = re.sub(r"\s+", " ", normalized)

    # remove leading/trailing hyphens
    normalized = normalized.strip("-")

    return normalized


def normalize_tags(tags: list[str]) -> set[str]:
    """normalize a list of tags, deduplicating and filtering empty.

    returns a set of normalized, unique tag names.
    """
    normalized = set()
    for tag in tags:
        n = normalize_tag(tag)
        if n:
            normalized.add(n)
    return normalized


def is_tag_hidden_by_default(tag: str) -> bool:
    """check if a tag should be hidden by default."""
    return normalize_tag(tag) in DEFAULT_HIDDEN_TAGS


# --- DB-facing tag operations ---
# Tag/TrackTag imports are deferred to avoid circular import:
# models/__init__.py -> models/preferences.py -> utilities/tags.py


async def get_or_create_tag(
    db: AsyncSession, tag_name: str, creator_did: str
):  # returns Tag
    """get existing tag or create new one, handling race conditions.

    uses a select-then-insert pattern with IntegrityError handling
    to safely handle concurrent tag creation.
    """
    from backend.models import Tag

    # first try to find existing tag
    result = await db.execute(select(Tag).where(Tag.name == tag_name))
    tag = result.scalar_one_or_none()
    if tag:
        return tag

    # try to create new tag
    tag = Tag(
        name=tag_name,
        created_by_did=creator_did,
        created_at=datetime.now(UTC),
    )
    db.add(tag)

    try:
        await db.flush()
        return tag
    except IntegrityError as e:
        # only handle unique constraint violation on tag name (pgcode 23505)
        # re-raise other integrity errors (e.g., foreign key violations)
        pgcode = getattr(e.orig, "pgcode", None)
        if pgcode != "23505":
            raise
        # another process created the tag - rollback and fetch it
        await db.rollback()
        result = await db.execute(select(Tag).where(Tag.name == tag_name))
        tag = result.scalar_one()
        return tag


async def add_tags_to_track(
    db: AsyncSession,
    track_id: int,
    validated_tags: list[str],
    creator_did: str,
) -> None:
    """add validated tags to a track."""
    from backend.models import TrackTag

    if not validated_tags:
        return

    try:
        for tag_name in validated_tags:
            tag = await get_or_create_tag(db, tag_name, creator_did)
            track_tag = TrackTag(track_id=track_id, tag_id=tag.id)
            db.add(track_tag)
        await db.commit()
    except Exception as e:
        logfire.error(
            "failed to add tags to track",
            track_id=track_id,
            tags=validated_tags,
            error=str(e),
        )

"""tag normalization and management utilities."""

import re
from typing import Annotated

from pydantic import Field, TypeAdapter, ValidationError

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

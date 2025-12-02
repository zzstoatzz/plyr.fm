"""tag normalization and management utilities."""

import json
import re

# tags that are hidden by default for new users
DEFAULT_HIDDEN_TAGS: list[str] = ["ai"]

# tag validation constraints
MAX_TAG_LENGTH = 50
MAX_TAGS_PER_TRACK = 10


class TagValidationError(ValueError):
    """raised when tag validation fails."""


def validate_tags_json(tags_json: str | None) -> list[str]:
    """validate and parse a JSON array of tag names.

    args:
        tags_json: JSON string containing array of tag names, or None

    returns:
        list of validated, normalized tag names

    raises:
        TagValidationError: if tags_json is malformed or contains invalid tags
    """
    if not tags_json:
        return []

    try:
        tag_names = json.loads(tags_json)
    except json.JSONDecodeError as e:
        raise TagValidationError(f"tags must be a valid JSON array: {e}") from e

    if not isinstance(tag_names, list):
        raise TagValidationError("tags must be a JSON array")

    # validate each tag
    validated: list[str] = []
    for i, tag in enumerate(tag_names):
        if not isinstance(tag, str):
            raise TagValidationError(f"tag at index {i} must be a string")

        normalized = normalize_tag(tag)
        if not normalized:
            continue  # skip empty tags after normalization

        if len(normalized) > MAX_TAG_LENGTH:
            raise TagValidationError(
                f"tag '{normalized[:20]}...' exceeds maximum length of {MAX_TAG_LENGTH}"
            )

        validated.append(normalized)

    # deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for tag in validated:
        if tag not in seen:
            seen.add(tag)
            unique.append(tag)

    if len(unique) > MAX_TAGS_PER_TRACK:
        raise TagValidationError(
            f"too many tags: {len(unique)} (maximum {MAX_TAGS_PER_TRACK})"
        )

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

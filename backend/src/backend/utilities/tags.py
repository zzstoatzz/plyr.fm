"""tag normalization and management utilities."""

import re

# tags that are hidden by default for new users
DEFAULT_HIDDEN_TAGS: list[str] = ["ai"]


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

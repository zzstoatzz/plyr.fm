"""utilities for generating URL-safe slugs."""

import re


def slugify(text: str) -> str:
    """convert text to URL-safe slug.

    examples:
        "My Album" -> "my-album"
        "Album (Deluxe Edition)" -> "album-deluxe-edition"
        "Test   Multiple   Spaces" -> "test-multiple-spaces"
    """
    if not text:
        return ""

    # lowercase
    slug = text.lower()

    # remove non-alphanumeric characters (keep spaces and hyphens)
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)

    # replace whitespace with hyphens
    slug = re.sub(r"\s+", "-", slug)

    # remove duplicate hyphens
    slug = re.sub(r"-+", "-", slug)

    # strip leading/trailing hyphens
    slug = slug.strip("-")

    return slug

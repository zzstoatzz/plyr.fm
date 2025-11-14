"""utilities for generating URL-safe slugs."""

import re


def slugify(text: str, max_length: int = 100) -> str:
    """convert text to URL-safe slug.

    args:
        text: text to slugify
        max_length: maximum length of the slug (default: 100)

    examples:
        "My Album" -> "my-album"
        "Album (Deluxe Edition)" -> "album-deluxe-edition"
        "Test   Multiple   Spaces" -> "test-multiple-spaces"
        "Field recordings of life around NY, parables..." -> "field-recordings-of-life-around-ny-parables"
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

    # truncate to max_length, ensuring we don't cut in the middle of a word
    if len(slug) > max_length:
        slug = slug[:max_length]
        # find the last hyphen to avoid cutting mid-word
        last_hyphen = slug.rfind("-")
        if last_hyphen > 0:
            slug = slug[:last_hyphen]

    return slug

"""utilities for generating URL-safe slugs."""

import re
import unicodedata


def slugify(text: str, max_length: int = 100) -> str:
    """convert text to URL-safe slug.

    args:
        text: text to slugify
        max_length: maximum length of the slug (default: 100)

    examples:
        "My Album" -> "my-album"
        "Album (Deluxe Edition)" -> "album-deluxe-edition"
        "Test   Multiple   Spaces" -> "test-multiple-spaces"
        "tūnņg" -> "tunng"
        "Études pour dac" -> "etudes-pour-dac"
    """
    if not text:
        return ""

    # transliterate accented characters to their ASCII base (ū -> u, ñ -> n)
    # before the ASCII filter below deletes them outright
    slug = unicodedata.normalize("NFKD", text)
    slug = slug.encode("ascii", "ignore").decode("ascii")

    # lowercase
    slug = slug.lower()

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

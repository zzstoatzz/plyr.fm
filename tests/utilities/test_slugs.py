"""test slug generation utilities."""

import pytest

from backend.utilities.slugs import slugify


@pytest.mark.parametrize(
    "input_text,expected",
    [
        ("My Album", "my-album"),
        ("Album (Deluxe Edition)", "album-deluxe-edition"),
        ("Test   Multiple   Spaces", "test-multiple-spaces"),
        ("Café MÜNCHËN", "caf-mnchn"),
        ("---Leading and Trailing---", "leading-and-trailing"),
        ("Special @#$% Characters!", "special-characters"),
        ("", ""),
        ("Already-Lowercase-Slug", "already-lowercase-slug"),
        ("123 Numbers", "123-numbers"),
        ("underscore_test", "underscoretest"),
    ],
)
def test_slugify(input_text: str, expected: str):
    """test slug generation from various inputs."""
    assert slugify(input_text) == expected


def test_slugify_preserves_hyphens():
    """test that existing hyphens are preserved."""
    assert slugify("my-hyphenated-title") == "my-hyphenated-title"


def test_slugify_removes_duplicates():
    """test that duplicate hyphens are collapsed."""
    assert slugify("multiple---hyphens") == "multiple-hyphens"

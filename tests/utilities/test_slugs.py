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


def test_slugify_respects_max_length():
    """test that slugs are truncated to max_length."""
    long_text = "this is a very long album title that should be truncated to avoid issues with extremely long URLs and file paths that could cause problems"
    result = slugify(long_text, max_length=50)
    assert len(result) <= 50
    assert result == "this-is-a-very-long-album-title-that-should-be"


def test_slugify_truncates_at_word_boundary():
    """test that truncation happens at word boundaries (hyphens)."""
    text = "Field recordings of life around NY, parables from Tigray, ignant hype shit, peaceful noise."
    result = slugify(text)  # uses default 100 max
    assert len(result) <= 100
    assert not result.endswith("-")  # should not end with hyphen
    # full slug should fit within 100 chars (special chars removed, so shorter than original)
    expected = "field-recordings-of-life-around-ny-parables-from-tigray-ignant-hype-shit-peaceful-noise"
    assert result == expected
    assert len(result) == 87  # commas and period removed during slugify


def test_slugify_default_max_length():
    """test that default max_length is 100."""
    long_text = "a" * 150
    result = slugify(long_text)
    assert len(result) <= 100
    assert len(result) == 100

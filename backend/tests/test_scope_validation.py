"""tests for OAuth scope validation functions."""

from backend._internal.auth.scopes import (
    check_scope_coverage,
    get_missing_scopes,
)


class TestCheckScopeCoverage:
    """tests for check_scope_coverage."""

    def test_returns_true_when_all_scopes_granted(self):
        """should return True when granted scope covers all required."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        assert check_scope_coverage(granted, required) is True

    def test_returns_true_when_extra_scopes_granted(self):
        """should return True when granted has more than required."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment repo:fm.plyr.extra"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        assert check_scope_coverage(granted, required) is True

    def test_returns_false_when_missing_scope(self):
        """should return False when granted is missing required scope."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        assert check_scope_coverage(granted, required) is False

    def test_returns_false_when_granted_empty(self):
        """should return False when granted scope is empty."""
        granted = ""
        required = "atproto repo:fm.plyr.track"
        assert check_scope_coverage(granted, required) is False

    def test_returns_true_when_both_empty(self):
        """should return True when both are empty."""
        assert check_scope_coverage("", "") is True

    def test_wildcard_collection_covers_specific(self):
        """repo:* should cover any specific collection."""
        granted = "atproto repo:*"
        required = "atproto repo:fm.plyr.track"
        assert check_scope_coverage(granted, required) is True

    def test_format_equivalence(self):
        """repo:nsid == repo?collection=nsid."""
        granted = "atproto repo?collection=fm.plyr.track"
        required = "atproto repo:fm.plyr.track"
        assert check_scope_coverage(granted, required) is True

    def test_blob_scope_coverage(self):
        """blob scopes should be checked."""
        granted = "atproto blob:*/*"
        required = "atproto blob:*/*"
        assert check_scope_coverage(granted, required) is True


class TestGetMissingScopes:
    """tests for get_missing_scopes."""

    def test_returns_empty_when_all_covered(self):
        """should return empty set when all scopes are granted."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        result = get_missing_scopes(granted, required)
        assert result == set()

    def test_returns_missing_scope(self):
        """should return the missing scope."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        result = get_missing_scopes(granted, required)
        assert result == {"repo:fm.plyr.comment"}

    def test_returns_multiple_missing_scopes(self):
        """should return all missing scopes."""
        granted = "atproto repo:fm.plyr.track"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        result = get_missing_scopes(granted, required)
        assert result == {"repo:fm.plyr.like", "repo:fm.plyr.comment"}

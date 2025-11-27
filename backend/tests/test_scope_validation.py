"""tests for OAuth scope validation functions."""

from backend._internal.auth import (
    _check_scope_coverage,
    _get_missing_scopes,
    _parse_scopes,
)


class TestParseScopes:
    """tests for _parse_scopes."""

    def test_parses_standard_scope_string(self):
        """should extract repo: scopes from atproto scope string."""
        scope = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        result = _parse_scopes(scope)
        assert result == {"repo:fm.plyr.track", "repo:fm.plyr.like"}

    def test_ignores_atproto_prefix(self):
        """should not include 'atproto' in parsed scopes."""
        scope = "atproto repo:fm.plyr.track"
        result = _parse_scopes(scope)
        assert "atproto" not in result
        assert result == {"repo:fm.plyr.track"}

    def test_handles_empty_string(self):
        """should return empty set for empty scope."""
        result = _parse_scopes("")
        assert result == set()

    def test_handles_multiple_scopes(self):
        """should handle three or more scopes."""
        scope = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        result = _parse_scopes(scope)
        assert result == {
            "repo:fm.plyr.track",
            "repo:fm.plyr.like",
            "repo:fm.plyr.comment",
        }


class TestCheckScopeCoverage:
    """tests for _check_scope_coverage."""

    def test_returns_true_when_all_scopes_granted(self):
        """should return True when granted scope covers all required."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        assert _check_scope_coverage(granted, required) is True

    def test_returns_true_when_extra_scopes_granted(self):
        """should return True when granted has more than required."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment repo:fm.plyr.extra"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        assert _check_scope_coverage(granted, required) is True

    def test_returns_false_when_missing_scope(self):
        """should return False when granted is missing required scope."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        assert _check_scope_coverage(granted, required) is False

    def test_returns_false_when_granted_empty(self):
        """should return False when granted scope is empty."""
        granted = ""
        required = "atproto repo:fm.plyr.track"
        assert _check_scope_coverage(granted, required) is False

    def test_returns_true_when_both_empty(self):
        """should return True when both are empty."""
        assert _check_scope_coverage("", "") is True


class TestGetMissingScopes:
    """tests for _get_missing_scopes."""

    def test_returns_empty_when_all_covered(self):
        """should return empty set when all scopes are granted."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        result = _get_missing_scopes(granted, required)
        assert result == set()

    def test_returns_missing_scope(self):
        """should return the missing scope."""
        granted = "atproto repo:fm.plyr.track repo:fm.plyr.like"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        result = _get_missing_scopes(granted, required)
        assert result == {"repo:fm.plyr.comment"}

    def test_returns_multiple_missing_scopes(self):
        """should return all missing scopes."""
        granted = "atproto repo:fm.plyr.track"
        required = "atproto repo:fm.plyr.track repo:fm.plyr.like repo:fm.plyr.comment"
        result = _get_missing_scopes(granted, required)
        assert result == {"repo:fm.plyr.like", "repo:fm.plyr.comment"}

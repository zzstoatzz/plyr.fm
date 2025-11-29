"""tests for user-agent parsing and span enrichment."""

import pytest

from backend.main import parse_plyrfm_user_agent


class TestParsePlyrfmUserAgent:
    """tests for parse_plyrfm_user_agent function."""

    def test_sdk_user_agent(self) -> None:
        """sdk user-agent returns client_type=sdk with version."""
        result = parse_plyrfm_user_agent("plyrfm/0.1.0")
        assert result == {"client_type": "sdk", "client_version": "0.1.0"}

    def test_mcp_user_agent(self) -> None:
        """mcp user-agent returns client_type=mcp with version."""
        result = parse_plyrfm_user_agent("plyrfm-mcp/0.2.1")
        assert result == {"client_type": "mcp", "client_version": "0.2.1"}

    def test_browser_user_agent(self) -> None:
        """standard browser user-agent returns client_type=browser."""
        result = parse_plyrfm_user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        assert result == {"client_type": "browser"}
        assert "client_version" not in result

    def test_none_user_agent(self) -> None:
        """missing user-agent returns client_type=browser."""
        result = parse_plyrfm_user_agent(None)
        assert result == {"client_type": "browser"}

    def test_empty_user_agent(self) -> None:
        """empty string user-agent returns client_type=browser."""
        result = parse_plyrfm_user_agent("")
        assert result == {"client_type": "browser"}

    def test_curl_user_agent(self) -> None:
        """curl user-agent returns client_type=browser (generic fallback)."""
        result = parse_plyrfm_user_agent("curl/8.4.0")
        assert result == {"client_type": "browser"}

    @pytest.mark.parametrize(
        ("user_agent", "expected_type", "expected_version"),
        [
            ("plyrfm/1.0.0", "sdk", "1.0.0"),
            ("plyrfm/0.0.1", "sdk", "0.0.1"),
            ("plyrfm/10.20.30", "sdk", "10.20.30"),
            ("plyrfm-mcp/1.0.0", "mcp", "1.0.0"),
            ("plyrfm-mcp/0.0.1", "mcp", "0.0.1"),
        ],
    )
    def test_version_variations(
        self, user_agent: str, expected_type: str, expected_version: str
    ) -> None:
        """various version formats are parsed correctly."""
        result = parse_plyrfm_user_agent(user_agent)
        assert result["client_type"] == expected_type
        assert result["client_version"] == expected_version

    def test_plyrfm_prefix_not_at_start(self) -> None:
        """plyrfm in middle of string is not matched (browser fallback)."""
        result = parse_plyrfm_user_agent("Mozilla/5.0 plyrfm/1.0.0")
        assert result == {"client_type": "browser"}

    def test_invalid_version_format(self) -> None:
        """invalid version format falls back to browser."""
        result = parse_plyrfm_user_agent("plyrfm/v1.0")
        assert result == {"client_type": "browser"}

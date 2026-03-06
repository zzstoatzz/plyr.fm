import os
import re

import pytest

from backend.config import FrontendSettings


def _make_settings(frontend_url: str) -> FrontendSettings:
    """create FrontendSettings with the given FRONTEND_URL."""
    env = os.environ.copy()
    os.environ["FRONTEND_URL"] = frontend_url
    try:
        return FrontendSettings()
    finally:
        os.environ.clear()
        os.environ.update(env)


def _matches(pattern: str, origin: str) -> bool:
    return re.match(pattern, origin) is not None


class TestProductionCorsOrigins:
    """CORS regex for production (FRONTEND_URL=https://plyr.fm)."""

    @pytest.fixture
    def regex(self) -> str:
        return _make_settings("https://plyr.fm").resolved_cors_origin_regex

    @pytest.mark.parametrize(
        "origin",
        [
            "https://plyr.fm",
            "https://www.plyr.fm",
            "https://docs.plyr.fm",
            "https://stg.plyr.fm",
            "https://zzstoatzz.github.io",
            "https://zzstoatzz.io",
            "http://localhost:5173",
        ],
    )
    def test_allowed(self, regex: str, origin: str) -> None:
        assert _matches(regex, origin), f"{origin} should be allowed"

    @pytest.mark.parametrize(
        "origin",
        [
            "https://evil-plyr.fm",
            "https://notplyr.fm",
            "http://plyr.fm",
        ],
    )
    def test_rejected(self, regex: str, origin: str) -> None:
        assert not _matches(regex, origin), f"{origin} should be rejected"


class TestStagingCorsOrigins:
    """CORS regex for staging (FRONTEND_URL=https://stg.plyr.fm)."""

    @pytest.fixture
    def regex(self) -> str:
        return _make_settings("https://stg.plyr.fm").resolved_cors_origin_regex

    @pytest.mark.parametrize(
        "origin",
        [
            "https://stg.plyr.fm",
            "https://docs.stg.plyr.fm",
            "http://localhost:5173",
        ],
    )
    def test_allowed(self, regex: str, origin: str) -> None:
        assert _matches(regex, origin), f"{origin} should be allowed"

    @pytest.mark.parametrize(
        "origin",
        [
            "https://plyr.fm",
            "https://evil-stg.plyr.fm",
        ],
    )
    def test_rejected(self, regex: str, origin: str) -> None:
        assert not _matches(regex, origin), f"{origin} should be rejected"


class TestLocalDevCorsOrigins:
    """CORS regex for local dev (FRONTEND_URL=http://localhost:5173)."""

    @pytest.fixture
    def regex(self) -> str:
        return _make_settings("http://localhost:5173").resolved_cors_origin_regex

    def test_allows_localhost(self, regex: str) -> None:
        assert _matches(regex, "http://localhost:5173")

    def test_rejects_remote(self, regex: str) -> None:
        assert not _matches(regex, "https://plyr.fm")

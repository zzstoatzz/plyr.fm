"""Tests for rate limiting configuration."""

from unittest.mock import patch

from backend.config import settings


def test_limiter_uses_redis_when_docket_url_set() -> None:
    """limiter should use docket Redis URL for storage when available."""
    with patch.object(settings.docket, "url", "redis://localhost:6379/0"):
        # re-import to pick up patched settings
        import importlib

        import backend.utilities.rate_limit as rl_module

        importlib.reload(rl_module)

        assert rl_module.limiter._storage_uri == "redis://localhost:6379/0"

    # reload again to restore original state
    importlib.reload(rl_module)


def test_limiter_falls_back_to_memory_when_no_docket_url() -> None:
    """limiter should fall back to in-memory storage when DOCKET_URL is empty."""
    with patch.object(settings.docket, "url", ""):
        import importlib

        import backend.utilities.rate_limit as rl_module

        importlib.reload(rl_module)

        assert rl_module.limiter._storage_uri == "memory://"

    importlib.reload(rl_module)

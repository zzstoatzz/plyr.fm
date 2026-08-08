"""Tests for rate limiting configuration."""

from unittest.mock import patch

from fastapi.testclient import TestClient

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


def test_api_survives_rate_limit_storage_outage(client: TestClient) -> None:
    """#1782: an unreachable Redis must not 500 the API.

    slowapi hands any storage exception to its rate-limit handler, which reads
    `exc.detail`. redis errors have no such attribute, so before the fallback was
    enabled every request -- including /health -- died with

        AttributeError: 'ConnectionError' object has no attribute 'detail'

    that failed the platform health check during a Redis restart, which turns a
    brief blip into machines being cycled.
    """
    from backend.utilities.rate_limit import limiter

    was_dead = limiter._storage_dead
    try:
        with patch.object(
            limiter.limiter,
            "hit",
            side_effect=ConnectionError("redis down"),
        ):
            response = client.get("/health")

        assert response.status_code == 200, (
            f"expected the request to survive a storage outage, got "
            f"{response.status_code}: {response.text[:200]}"
        )
    finally:
        limiter._storage_dead = was_dead


def test_rate_limiting_recovers_after_storage_returns(client: TestClient) -> None:
    """the in-memory fallback is not a one-way door -- storage is probed again."""
    from backend.utilities.rate_limit import limiter

    was_dead = limiter._storage_dead
    try:
        with patch.object(
            limiter.limiter, "hit", side_effect=ConnectionError("redis down")
        ):
            assert client.get("/health").status_code == 200

        limiter._storage_dead = False
        assert client.get("/health").status_code == 200
    finally:
        limiter._storage_dead = was_dead

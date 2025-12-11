"""redis client utilities for distributed caching.

provides async redis client initialized from docket URL settings.
the client is lazily created and cached per event loop.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

import redis.asyncio as async_redis

from backend.config import settings

logger = logging.getLogger(__name__)

# client cache keyed by event loop to handle multiple loops in tests
_client_cache: dict[int, async_redis.Redis] = {}


def _parse_redis_url(url: str) -> dict:
    """parse a redis URL into connection kwargs.

    supports:
        - redis://host:port/db
        - redis://user:password@host:port/db
        - rediss://... (SSL)
    """
    parsed = urlparse(url)

    kwargs: dict[str, Any] = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 6379,
        "db": int(parsed.path.lstrip("/") or 0),
        "decode_responses": True,
    }

    if parsed.username:
        kwargs["username"] = parsed.username
    if parsed.password:
        kwargs["password"] = parsed.password
    if parsed.scheme == "rediss":
        kwargs["ssl"] = True

    return kwargs


def get_async_redis_client() -> async_redis.Redis:
    """get a cached async redis client.

    the client is created lazily on first call and reused.
    parses connection info from settings.docket.url.

    returns:
        async redis client

    raises:
        RuntimeError: if docket URL is not configured
    """
    try:
        loop = asyncio.get_running_loop()
        loop_id = id(loop)
    except RuntimeError:
        loop_id = 0

    if loop_id in _client_cache:
        return _client_cache[loop_id]

    if not settings.docket.url:
        raise RuntimeError("docket URL not configured - cannot create redis client")

    kwargs = _parse_redis_url(settings.docket.url)

    client = async_redis.Redis(
        socket_connect_timeout=5.0,
        **kwargs,
    )

    _client_cache[loop_id] = client
    logger.debug("created async redis client for loop %s", loop_id)

    return client


@asynccontextmanager
async def async_redis_client() -> AsyncGenerator[async_redis.Redis, None]:
    """async context manager for redis client.

    ensures proper cleanup when used in isolated contexts.
    for most cases, prefer get_async_redis_client() which caches
    the connection for reuse.

    yields:
        async redis client

    raises:
        RuntimeError: if docket URL is not configured
    """
    if not settings.docket.url:
        raise RuntimeError("docket URL not configured - cannot create redis client")

    kwargs = _parse_redis_url(settings.docket.url)
    client = async_redis.Redis(
        socket_connect_timeout=5.0,
        **kwargs,
    )

    try:
        yield client
    finally:
        await client.aclose()


async def close_redis_client() -> None:
    """close all cached redis clients."""
    try:
        loop = asyncio.get_running_loop()
        loop_id = id(loop)
    except RuntimeError:
        loop_id = 0

    if loop_id in _client_cache:
        client = _client_cache.pop(loop_id)
        await client.aclose()
        logger.debug("closed async redis client for loop %s", loop_id)


def clear_client_cache() -> None:
    """clear the client cache. primarily for testing."""
    _client_cache.clear()

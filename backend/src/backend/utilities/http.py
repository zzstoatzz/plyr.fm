"""shared httpx client for connection pooling.

creating a new httpx.AsyncClient() per request has overhead - connection setup,
TLS handshake, etc. this module provides a shared client with connection pooling
for better performance at scale.

usage:
    from backend.utilities.http import get_http_client

    async def my_function():
        client = get_http_client()
        response = await client.get("https://example.com")
"""

import httpx

# shared client with connection pooling.
# - max 100 connections total across all hosts
# - max 10 connections per host (prevents overwhelming any single server)
# - 30 second timeout for establishing connections
# - keepalive connections reused for subsequent requests
_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """get the shared httpx client.

    lazily initializes the client on first use to avoid event loop issues
    at import time. the client is reused across all requests for connection
    pooling benefits.

    returns:
        shared AsyncClient instance
    """
    global _http_client

    if _http_client is None:
        _http_client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=20,
            ),
            timeout=httpx.Timeout(
                connect=10.0,
                read=30.0,
                write=10.0,
                pool=10.0,
            ),
        )

    return _http_client


async def close_http_client() -> None:
    """close the shared httpx client.

    should be called during application shutdown to cleanly close connections.
    """
    global _http_client

    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None

"""Rate limiting utility.

Limits are per client. That sounds obvious, but it was not true: the key was
`get_remote_address`, which reads `request.client.host`, and behind Fly's proxy
that is the proxy -- the same `172.16.7.50` for every request from every user.
With shared Redis storage this made `default_limits` a single bucket for the
entire site, so any one caller could spend everyone's budget. Production peaked
at 124 requests in a minute against a 100/minute ceiling and returned 298 429s
on `/radio/state` alone: radio listeners poll every 30 seconds and were knocking
each other offline.

A global limiter is worse than no limiter for availability, because it turns one
misbehaving client into a site-wide outage. Hence per-client keying.
"""

import hashlib

from slowapi import Limiter
from starlette.requests import Request

from backend.config import settings

# Fly terminates the connection and forwards the caller's address in a header;
# `request.client.host` is Fly's own proxy. X-Forwarded-For is the fallback:
# its leftmost entry is the original client, the rest are proxies.
_CLIENT_IP_HEADER = "fly-client-ip"
_FORWARDED_FOR_HEADER = "x-forwarded-for"


def _hashed(value: str) -> str:
    """Short digest, so a raw session token never becomes a Redis key."""
    return hashlib.sha256(value.encode()).hexdigest()[:32]


def client_ip(request: Request) -> str:
    """The caller's address, or a stable placeholder when it cannot be found."""
    if fly_ip := request.headers.get(_CLIENT_IP_HEADER):
        return fly_ip.strip()
    if forwarded := request.headers.get(_FORWARDED_FOR_HEADER):
        if first := forwarded.split(",")[0].strip():
            return first
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def rate_limit_key(request: Request) -> str:
    """Identify the caller, preferring session over network address.

    A session follows the person rather than the network, so it is both more
    accurate and better for privacy: an authenticated request never has its IP
    used for anything. The identifier is hashed because it is a bearer
    credential, and a Redis key is not the place for one.

    An IP is the key only for anonymous callers, where nothing else identifies
    them. It is used transiently -- as a key carrying the window's TTL -- and is
    never written to the database or the logs.
    """
    if session_id := request.cookies.get("session_id"):
        return f"s:{_hashed(session_id)}"
    if authorization := request.headers.get("authorization"):
        return f"t:{_hashed(authorization)}"
    return f"ip:{client_ip(request)}"


limiter = Limiter(
    key_func=rate_limit_key,
    enabled=settings.rate_limit.enabled,
    default_limits=[settings.rate_limit.default_limit],
    storage_uri=settings.docket.url or "memory://",
)

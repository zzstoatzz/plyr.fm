"""detect whether a PDS implements the permissioned-data space surface.

no PDS advertises this declaratively (not describeServer, not .well-known, not
OAuth metadata; ZDS's openapi.json is vendor-specific). so we **probe**: call a
`com.atproto.space.*` method with the user's auth and branch on the response.

    supported   -> the method dispatches for real (2xx, or a genuine
                   InvalidRequest / InsufficientScope / auth error proving the
                   route exists and ran)
    unsupported -> HTTP 404/501 or an error in {MethodNotImplemented,
                   UnknownMethod, XRPCNotSupported} (identical across a
                   ZDS with the flag off and a vanilla PDS like bsky/tranquil)

ambiguous results (transient 5xx, network) fail **closed** and are not cached, so a
blip never pins a capable PDS to "unsupported" for the cache lifetime.

the probe is authenticated: an unauthenticated call can't distinguish a supporting
PDS from a vanilla one, because PDS auth middleware returns 401 before method routing.
"""

import logging
import re

from redis.exceptions import RedisError

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend.config import settings
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "permissioned_capability:"
_CACHE_TTL_SECONDS = 6 * 60 * 60

# error codes that mean "this PDS does not implement the space surface"
_UNSUPPORTED_ERROR_CODES = (
    "MethodNotImplemented",
    "UnknownMethod",
    "XRPCNotSupported",
    "MethodNotSupported",
)
_UNSUPPORTED_STATUS = (404, 501)

_STATUS_RE = re.compile(r"PDS request failed:\s*(\d{3})")


def _classify_failure(message: str) -> bool | None:
    """interpret a failed listSpaces probe.

    returns True (supported), False (definitively unsupported), or None (ambiguous
    / transient — caller should fail closed without caching).
    """
    if any(code in message for code in _UNSUPPORTED_ERROR_CODES):
        return False
    if match := _STATUS_RE.search(message):
        status = int(match.group(1))
        if status in _UNSUPPORTED_STATUS:
            return False
        if 500 <= status < 600:
            return None  # transient upstream failure
        return True  # 4xx other than 404: the route dispatched (auth/scope/validation)
    return None


async def _probe(auth_session: AuthSession) -> bool | None:
    """probe listSpaces. True/False = definitive; None = ambiguous (don't cache)."""
    try:
        await make_pds_request(
            auth_session,
            "GET",
            "com.atproto.space.listSpaces",
            params={
                "did": auth_session.did,
                "type": settings.atproto.private_media_space_type,
            },
        )
        return True
    except Exception as exc:  # make_pds_request raises a bare Exception on non-2xx
        return _classify_failure(str(exc))


async def detect_permissioned_capability(auth_session: AuthSession) -> bool:
    """whether the session's PDS implements permissioned spaces (cached per PDS)."""
    pds_url = (auth_session.oauth_session or {}).get("pds_url")
    cache_key = f"{_CACHE_PREFIX}{pds_url}" if pds_url else None

    redis = None
    if cache_key:
        try:
            redis = get_async_redis_client()
            if (cached := await redis.get(cache_key)) is not None:
                return cached == "1"
        except RedisError as exc:
            logger.debug("permissioned capability cache read failed: %s", exc)
            redis = None

    result = await _probe(auth_session)
    if result is None:
        return False  # ambiguous: fail closed, do not cache

    if redis is not None and cache_key:
        try:
            await redis.set(cache_key, "1" if result else "0", ex=_CACHE_TTL_SECONDS)
        except RedisError as exc:
            logger.debug("permissioned capability cache write failed: %s", exc)

    return result

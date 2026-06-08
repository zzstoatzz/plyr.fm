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

# bumped to v2 when the classifier flipped to fail-closed — invalidates any stale
# (overly-permissive) cached results from the prior heuristic.
_CACHE_PREFIX = "permissioned_capability:v2:"
_CACHE_TTL_SECONDS = 6 * 60 * 60

_STATUS_RE = re.compile(r"PDS request failed:\s*(\d{3})")


def _classify_failure(message: str) -> bool | None:
    """interpret a FAILED listSpaces probe — fail closed.

    a PDS is treated as supporting permissioned spaces ONLY on an unambiguous
    positive signal (handled in `_probe`: HTTP 200, or 403 InsufficientScope —
    ZDS's space-scope check, which proves the route is implemented). every other
    failure is unsupported; a non-supporting PDS returns auth/method-not-found
    errors that must NOT be read as "route exists."

    returns True (supported), False (unsupported, cacheable), or None (transient
    — don't cache, fail closed for this call only).
    """
    # the space-scope check ran → the route is implemented → supported
    if "InsufficientScope" in message:
        return True
    if match := _STATUS_RE.search(message):
        status = int(match.group(1))
        if status == 501:
            return False  # not implemented
        if 500 <= status < 600:
            return None  # transient upstream failure (500/502/503/504)
        return False  # 401/400/404/405/other 4xx → not a supporting PDS
    return None  # opaque / network error


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

"""whether a session can use permissioned spaces (private media).

Two questions, each answered by the thing that actually knows:

- **can this PDS do spaces at all?** its OAuth authorization server lists a
  ``space:`` scope in ``scopes_supported``. Declarative, available before we
  ask the user for anything, and stable enough to cache per issuer. This
  decides whether private media is offered.
- **may this session write to the space?** the granted token carries the
  expanded ``space:`` grant (see
  [space_scope][backend._internal.auth.space_scope]). This decides whether a
  write is allowed.

Never offer what the first question says is impossible, and never authorize on
anything but the second.
"""

import logging

import httpx
from atproto_oauth.security import is_safe_url
from redis.exceptions import RedisError

from backend._internal.auth.session import Session as AuthSession
from backend._internal.auth.space_scope import (
    private_media_grant_present,
    private_media_reader_grant_present,
)
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

_CACHE_PREFIX = "spaces_supported:v1:"
_CACHE_TTL_SECONDS = 6 * 60 * 60


def session_has_private_media_access(auth_session: AuthSession) -> bool:
    """whether this session may write to the user's private-media space."""
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_grant_present(data.get("scope", ""), auth_session.did)


def session_can_read_shared_private_media(auth_session: AuthSession) -> bool:
    """whether this session may read private-media spaces artists shared with it."""
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_reader_grant_present(data.get("scope", ""))


def advertises_spaces(metadata: dict) -> bool:
    """whether authorization-server metadata offers any ``space:`` scope."""
    scopes = metadata.get("scopes_supported")
    if not isinstance(scopes, list):
        return False
    return any(
        isinstance(scope, str) and (scope == "space" or scope.startswith("space:"))
        for scope in scopes
    )


async def pds_supports_spaces(auth_session: AuthSession) -> bool:
    """whether the session's authorization server advertises a ``space:`` scope.

    A transient failure answers "no": offering private media we cannot deliver
    is worse than hiding it for one page load.
    """
    issuer = (auth_session.oauth_session or {}).get("authserver_iss")
    if not issuer:
        return False
    issuer = issuer.rstrip("/")

    redis = None
    cache_key = f"{_CACHE_PREFIX}{issuer}"
    try:
        redis = get_async_redis_client()
        if (cached := await redis.get(cache_key)) is not None:
            return cached == "1"
    except RedisError as exc:
        logger.debug("spaces capability cache read failed: %s", exc)
        redis = None

    url = f"{issuer}/.well-known/oauth-authorization-server"
    if not is_safe_url(url):
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            response = await http.get(url)
        if response.status_code != 200:
            return False
        supported = advertises_spaces(response.json())
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("could not read authserver metadata for %s: %s", issuer, exc)
        return False

    if redis is not None:
        try:
            await redis.set(cache_key, "1" if supported else "0", ex=_CACHE_TTL_SECONDS)
        except RedisError as exc:
            logger.debug("spaces capability cache write failed: %s", exc)
    return supported

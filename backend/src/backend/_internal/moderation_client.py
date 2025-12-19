"""moderation service client.

centralized client for all moderation service interactions.
replaces scattered httpx calls with a single, testable interface.
"""

import logging
from dataclasses import dataclass
from typing import Any

import httpx
import logfire

from backend.config import settings
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)


@dataclass
class ScanResult:
    """result from a copyright scan."""

    is_flagged: bool
    highest_score: int
    matches: list[dict[str, Any]]
    raw_response: dict[str, Any]


@dataclass
class EmitLabelResult:
    """result from emitting a label."""

    success: bool
    error: str | None = None


class ModerationClient:
    """client for the plyr.fm moderation service.

    provides a clean interface for:
    - scanning audio for copyright matches
    - emitting ATProto labels
    - checking active labels
    - caching label status in redis

    usage:
        client = ModerationClient.from_settings()
        result = await client.scan(audio_url)
    """

    def __init__(
        self,
        service_url: str,
        labeler_url: str,
        auth_token: str,
        timeout_seconds: float | int,
        label_cache_prefix: str,
        label_cache_ttl_seconds: int,
    ) -> None:
        self.service_url = service_url
        self.labeler_url = labeler_url
        self.auth_token = auth_token
        self.timeout = httpx.Timeout(timeout_seconds)
        self.label_cache_prefix = label_cache_prefix
        self.label_cache_ttl_seconds = label_cache_ttl_seconds

    @classmethod
    def from_settings(cls) -> "ModerationClient":
        """create a client from application settings."""
        return cls(
            service_url=settings.moderation.service_url,
            labeler_url=settings.moderation.labeler_url,
            auth_token=settings.moderation.auth_token,
            timeout_seconds=settings.moderation.timeout_seconds,
            label_cache_prefix=settings.moderation.label_cache_prefix,
            label_cache_ttl_seconds=settings.moderation.label_cache_ttl_seconds,
        )

    def _headers(self) -> dict[str, str]:
        """common auth headers."""
        return {"X-Moderation-Key": self.auth_token}

    async def scan(self, audio_url: str) -> ScanResult:
        """scan audio for potential copyright matches.

        args:
            audio_url: public URL of the audio file

        returns:
            ScanResult with match details

        raises:
            httpx.HTTPStatusError: on non-2xx response
            httpx.TimeoutException: on timeout
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.service_url}/scan",
                json={"audio_url": audio_url},
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()

            return ScanResult(
                is_flagged=data.get("is_flagged", False),
                highest_score=data.get("highest_score", 0),
                matches=data.get("matches", []),
                raw_response=data.get("raw_response", {}),
            )

    async def emit_label(
        self,
        uri: str,
        cid: str | None = None,
        val: str = "copyright-violation",
        context: dict[str, Any] | None = None,
    ) -> EmitLabelResult:
        """emit an ATProto label to the labeler service.

        args:
            uri: AT URI of the record to label
            cid: optional CID of the record
            val: label value (default: copyright-violation)
            context: optional metadata for admin UI display

        returns:
            EmitLabelResult indicating success/failure
        """
        payload: dict[str, Any] = {"uri": uri, "val": val}
        if cid:
            payload["cid"] = cid
        if context:
            payload["context"] = context

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
                response = await client.post(
                    f"{self.labeler_url}/emit-label",
                    json=payload,
                    headers=self._headers(),
                )
                response.raise_for_status()

                # invalidate cache since label status changed
                await self.invalidate_cache(uri)

                logfire.info("copyright label emitted", uri=uri, cid=cid)
                return EmitLabelResult(success=True)

        except Exception as e:
            logger.warning("failed to emit copyright label for %s: %s", uri, e)
            return EmitLabelResult(success=False, error=str(e))

    async def get_active_labels(self, uris: list[str]) -> set[str]:
        """check which URIs have active (non-negated) copyright-violation labels.

        uses redis cache to avoid repeated calls to the labeler service.
        fails closed (returns all URIs as active) if labeler is unreachable.

        args:
            uris: list of AT URIs to check

        returns:
            set of URIs that are still actively flagged
        """
        if not uris:
            return set()

        # check redis cache first
        active_from_cache: set[str] = set()
        uris_to_fetch: list[str] = []

        try:
            redis = get_async_redis_client()
            cache_keys = [f"{self.label_cache_prefix}{uri}" for uri in uris]
            cached_values = await redis.mget(cache_keys)

            for uri, cached_value in zip(uris, cached_values, strict=True):
                if cached_value is not None:
                    if cached_value == "1":
                        active_from_cache.add(uri)
                    # else: cached as "0" (not active), skip
                else:
                    uris_to_fetch.append(uri)
        except Exception as e:
            logger.warning("redis cache unavailable: %s", e)
            uris_to_fetch = list(uris)

        # if everything was cached, return early
        if not uris_to_fetch:
            logfire.debug(
                "checked active copyright labels (all cached)",
                total_uris=len(uris),
                active_count=len(active_from_cache),
            )
            return active_from_cache

        # fetch uncached URIs from labeler
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.labeler_url}/admin/active-labels",
                    json={"uris": uris_to_fetch},
                    headers=self._headers(),
                )
                response.raise_for_status()
                data = response.json()
                active_from_service = set(data.get("active_uris", []))

                # update redis cache
                await self._cache_label_status(uris_to_fetch, active_from_service)

                logfire.info(
                    "checked active copyright labels",
                    total_uris=len(uris),
                    cached_count=len(uris) - len(uris_to_fetch),
                    fetched_count=len(uris_to_fetch),
                    active_count=len(active_from_cache) + len(active_from_service),
                )
                return active_from_cache | active_from_service

        except Exception as e:
            # fail closed: if we can't confirm resolution, treat as active
            logger.warning(
                "failed to check active labels, treating all as active: %s", e
            )
            return set(uris)

    async def _cache_label_status(self, uris: list[str], active_uris: set[str]) -> None:
        """cache label status in redis."""
        try:
            redis = get_async_redis_client()
            async with redis.pipeline() as pipe:
                for uri in uris:
                    cache_key = f"{self.label_cache_prefix}{uri}"
                    value = "1" if uri in active_uris else "0"
                    await pipe.set(cache_key, value, ex=self.label_cache_ttl_seconds)
                await pipe.execute()
        except Exception as e:
            logger.warning("failed to update redis cache: %s", e)

    async def invalidate_cache(self, uri: str) -> None:
        """invalidate cache entry for a URI when its label status changes."""
        try:
            redis = get_async_redis_client()
            await redis.delete(f"{self.label_cache_prefix}{uri}")
        except Exception as e:
            logger.warning("failed to invalidate label cache for %s: %s", uri, e)

    async def clear_cache(self) -> None:
        """clear all label cache entries. primarily for testing."""
        try:
            redis = get_async_redis_client()
            cursor = 0
            while True:
                cursor, keys = await redis.scan(
                    cursor, match=f"{self.label_cache_prefix}*", count=100
                )
                if keys:
                    await redis.delete(*keys)
                if cursor == 0:
                    break
        except Exception as e:
            logger.warning("failed to clear label cache: %s", e)


# module-level singleton
_client: ModerationClient | None = None


def get_moderation_client() -> ModerationClient:
    """get the moderation client singleton.

    creates the client on first call, reuses on subsequent calls.
    """
    global _client
    if _client is None:
        _client = ModerationClient.from_settings()
    return _client

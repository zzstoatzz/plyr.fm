"""Shared HTTP client for the plyr.fm moderation service.

The service exposes two authenticated surfaces behind the same
``X-Moderation-Key``: ``/internal/*`` for the endpoints the backend calls on
its hot paths, and ``/admin/*`` for the moderator dashboard and the operator
tooling in this directory (#1691). Scripts belong on the operator surface, so
every path here is an ``/admin`` one.

Imported by sibling PEP 723 scripts, which run with this directory on
``sys.path``. It depends on ``httpx`` alone; any script importing it must
declare that dependency.
"""

from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

DEFAULT_SERVICE_URL = "https://moderation.plyr.fm"

FlagFilter = Literal["pending", "resolved", "all"]


@dataclass
class ModerationClient:
    """Operator-surface client for the moderation service."""

    base_url: str = DEFAULT_SERVICE_URL
    auth_token: str = ""
    timeout: float = 30.0
    _client: httpx.AsyncClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-Moderation-Key": self.auth_token},
            timeout=self.timeout,
        )

    async def __aenter__(self) -> "ModerationClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def list_flags(
        self, flag_filter: FlagFilter = "pending"
    ) -> list[dict[str, Any]]:
        response = await self._client.get(
            "/admin/flags", params={"filter": flag_filter}
        )
        response.raise_for_status()
        return response.json().get("tracks", [])

    async def resolve(
        self,
        uri: str,
        reason: str,
        notes: str = "",
        val: str = "copyright-violation",
    ) -> dict[str, Any]:
        """Negate a label, recording why a moderator dismissed it."""
        payload: dict[str, Any] = {"uri": uri, "val": val, "reason": reason}
        if notes:
            payload["notes"] = notes
        response = await self._client.post("/admin/resolve", json=payload)
        response.raise_for_status()
        return response.json()

    async def create_batch(
        self, uris: list[str], created_by: str | None = None
    ) -> dict[str, Any]:
        """Group flags into a reviewable batch, returning {id, url, flag_count}.

        An empty ``uris`` means "every pending flag" to the service, which is
        rarely what a caller wants by accident, so it is rejected here.
        """
        if not uris:
            raise ValueError("create_batch requires at least one uri")
        response = await self._client.post(
            "/admin/batches", json={"uris": uris, "created_by": created_by}
        )
        response.raise_for_status()
        return response.json()

    async def store_context(self, uri: str, context: dict[str, Any]) -> dict[str, Any]:
        """Attach display context to an existing label without re-emitting it."""
        response = await self._client.post(
            "/admin/context", json={"uri": uri, "context": context}
        )
        response.raise_for_status()
        return response.json()

    def review_url(self, batch: dict[str, Any]) -> str:
        """Absolute URL for a batch returned by :meth:`create_batch`."""
        return f"{self.base_url.rstrip('/')}{batch['url']}"

"""regression tests for handle → DID resolution with AppView XRPC fallback.

context: Bluesky's edge has been observed intermittently returning 403 on
`<handle>.bsky.social/.well-known/atproto-did` to certain egress IPs, which
broke new logins because the atproto SDK's `AsyncIdResolver.handle.resolve`
relies on that endpoint. the AppView XRPC at `public.api.bsky.app` resolves
the same handles fine, so we fall back to it before giving up.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from backend._internal.atproto.handles import _resolve_handle_to_did, resolve_handle


def _httpx_response(status_code: int, json_body: dict[str, Any]) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=json_body,
        request=httpx.Request("GET", "https://public.api.bsky.app/"),
    )


async def test_sdk_resolves_returns_did_without_xrpc_call() -> None:
    """happy path: SDK returns DID → no XRPC fallback needed."""
    with (
        patch(
            "backend._internal.atproto.handles._resolver",
            MagicMock(handle=MagicMock(resolve=AsyncMock(return_value="did:plc:abc"))),
        ),
        patch("backend._internal.atproto.handles.httpx.AsyncClient") as mock_client,
    ):
        did = await _resolve_handle_to_did("alice.bsky.social")

    assert did == "did:plc:abc"
    mock_client.assert_not_called()


async def test_sdk_returns_none_falls_back_to_appview_xrpc() -> None:
    """SDK returns None (e.g. `.well-known/atproto-did` 403'd) → XRPC succeeds."""
    mock_client_ctx = AsyncMock()
    mock_client_ctx.get = AsyncMock(
        return_value=_httpx_response(200, {"did": "did:plc:zqngs5cvyewmfzifevacxunk"})
    )
    mock_client = MagicMock()
    mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client_ctx)
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

    with (
        patch(
            "backend._internal.atproto.handles._resolver",
            MagicMock(handle=MagicMock(resolve=AsyncMock(return_value=None))),
        ),
        patch("backend._internal.atproto.handles.httpx.AsyncClient", mock_client),
    ):
        did = await _resolve_handle_to_did("ailawav.bsky.social")

    assert did == "did:plc:zqngs5cvyewmfzifevacxunk"
    mock_client_ctx.get.assert_called_once()
    call_url = mock_client_ctx.get.call_args[0][0]
    assert call_url.endswith("/xrpc/com.atproto.identity.resolveHandle")
    assert mock_client_ctx.get.call_args.kwargs["params"] == {"handle": "ailawav.bsky.social"}


async def test_sdk_raises_falls_back_to_appview_xrpc() -> None:
    """SDK raises (e.g. httpx.HTTPStatusError on 403) → XRPC fallback."""
    mock_client_ctx = AsyncMock()
    mock_client_ctx.get = AsyncMock(
        return_value=_httpx_response(200, {"did": "did:plc:devlogabc"})
    )
    mock_client = MagicMock()
    mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client_ctx)
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

    sdk_resolve = AsyncMock(side_effect=httpx.HTTPStatusError(
        "403 Forbidden",
        request=httpx.Request("GET", "https://x.bsky.social/.well-known/atproto-did"),
        response=httpx.Response(403, request=httpx.Request("GET", "https://x")),
    ))

    with (
        patch(
            "backend._internal.atproto.handles._resolver",
            MagicMock(handle=MagicMock(resolve=sdk_resolve)),
        ),
        patch("backend._internal.atproto.handles.httpx.AsyncClient", mock_client),
    ):
        did = await _resolve_handle_to_did("zzstoatzzdevlog.bsky.social")

    assert did == "did:plc:devlogabc"


async def test_both_paths_fail_returns_none() -> None:
    """SDK None + XRPC non-200 → None (not an exception)."""
    mock_client_ctx = AsyncMock()
    mock_client_ctx.get = AsyncMock(return_value=_httpx_response(400, {"error": "InvalidRequest"}))
    mock_client = MagicMock()
    mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client_ctx)
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

    with (
        patch(
            "backend._internal.atproto.handles._resolver",
            MagicMock(handle=MagicMock(resolve=AsyncMock(return_value=None))),
        ),
        patch("backend._internal.atproto.handles.httpx.AsyncClient", mock_client),
    ):
        did = await _resolve_handle_to_did("nonexistent.invalid")

    assert did is None


async def test_resolve_handle_returns_full_profile_via_fallback_did() -> None:
    """end-to-end: SDK fails → XRPC supplies DID → profile fetch hydrates the rest."""
    xrpc_resolve = _httpx_response(200, {"did": "did:plc:ailaresolved"})
    xrpc_profile = _httpx_response(200, {"displayName": "aila", "avatar": "https://cdn/x.jpg"})

    mock_client_ctx = AsyncMock()
    mock_client_ctx.get = AsyncMock(side_effect=[xrpc_resolve, xrpc_profile])
    mock_client = MagicMock()
    mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_client_ctx)
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)

    with (
        patch(
            "backend._internal.atproto.handles._resolver",
            MagicMock(handle=MagicMock(resolve=AsyncMock(return_value=None))),
        ),
        patch("backend._internal.atproto.handles.httpx.AsyncClient", mock_client),
    ):
        result = await resolve_handle("ailawav.bsky.social")

    assert result == {
        "did": "did:plc:ailaresolved",
        "handle": "ailawav.bsky.social",
        "display_name": "aila",
        "avatar_url": "https://cdn/x.jpg",
    }

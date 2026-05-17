"""regression tests for the bsky.social edge-block friendly error.

context: bluesky-social/atproto#4764 — bsky.social's edge has been observed
returning 403 to httpx-shaped requests from cloud egress, breaking handle
resolution and OAuth metadata fetches for `*.bsky.social` users. when that
happens the SDK raises `ValueError('Failed to resolve handle: X')` which we
otherwise surface as a stack-trace-flavored 400 — confusing for users since
it looks like an account problem.

`_bsky_edge_block_error` detects the failure shape and returns a 503 with a
clear "upstream Bluesky issue, try again" message instead.
"""

from fastapi import HTTPException

from backend._internal.auth.oauth import _bsky_edge_block_error


def test_bsky_handle_with_resolution_failure_gets_friendly_503() -> None:
    """typical end-user case: signing in with `*.bsky.social` handle hits SDK
    `Failed to resolve handle` because the underlying httpx request 403'd."""
    exc = ValueError("Failed to resolve handle: ailawav.bsky.social")
    result = _bsky_edge_block_error(exc, "ailawav.bsky.social")
    assert isinstance(result, HTTPException)
    assert result.status_code == 503
    assert "Bluesky's servers" in str(result.detail)
    assert "4764" in str(result.detail)


def test_explicit_403_on_bsky_social_url_gets_friendly_503() -> None:
    """the auth-server-metadata leg: handle resolution succeeds (self-hosted PDS
    works), but `fetch_authserver_metadata_async` 403s on bsky.social. message
    contains '403 Forbidden' and 'bsky.social', should also surface friendly."""
    exc = RuntimeError(
        "Client error '403 Forbidden' for url "
        "'https://bsky.social/.well-known/oauth-authorization-server'"
    )
    result = _bsky_edge_block_error(exc, "user.example.com")
    assert isinstance(result, HTTPException)
    assert result.status_code == 503


def test_unrelated_failure_returns_none() -> None:
    """genuinely-broken handles (typos on non-bsky domains) shouldn't trigger
    the upstream-issue framing — those really are user errors."""
    exc = ValueError("Failed to resolve handle: typo.example.com")
    assert _bsky_edge_block_error(exc, "typo.example.com") is None


def test_non_resolution_error_on_bsky_handle_returns_none() -> None:
    """defensive: unrelated errors on a bsky handle (e.g. config / state issues)
    shouldn't be masked as upstream — only the specific failure shape should."""
    exc = RuntimeError("OAuth state store unavailable")
    assert _bsky_edge_block_error(exc, "alice.bsky.social") is None

"""tests for concurrent token refresh locking."""

import asyncio
from unittest.mock import patch

import pytest
from atproto_oauth.models import OAuthSession
from cachetools import LRUCache
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import _refresh_locks, _refresh_session_tokens


@pytest.fixture
def mock_auth_session() -> AuthSession:
    """create mock auth session."""
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())

    dpop_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    return AuthSession(
        session_id="test-session-123",
        did="did:plc:test123",
        handle="test.bsky.social",
        oauth_session={
            "did": "did:plc:test123",
            "handle": "test.bsky.social",
            "pds_url": "https://pds.test",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "old-token",
            "refresh_token": "refresh-token",
            "dpop_private_key_pem": dpop_key_pem,
            "dpop_authserver_nonce": "nonce1",
            "dpop_pds_nonce": "nonce2",
        },
    )


@pytest.fixture
def mock_oauth_session() -> OAuthSession:
    """create mock oauth session."""
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())

    return OAuthSession(
        did="did:plc:test123",
        handle="test.bsky.social",
        pds_url="https://pds.test",
        authserver_iss="https://auth.test",
        access_token="old-token",
        refresh_token="refresh-token",
        dpop_private_key=private_key,
        dpop_authserver_nonce="nonce1",
        dpop_pds_nonce="nonce2",
        scope="atproto transition:generic",
    )


class TestConcurrentTokenRefresh:
    """test concurrent token refresh race condition handling."""

    async def test_concurrent_refresh_only_calls_once(
        self, mock_auth_session: AuthSession, mock_oauth_session: OAuthSession
    ):
        """test that concurrent refresh attempts only call the OAuth client once."""
        refresh_call_count = 0
        new_token = "new-refreshed-token"

        async def mock_refresh_session(self, session: OAuthSession) -> OAuthSession:
            nonlocal refresh_call_count
            refresh_call_count += 1
            await asyncio.sleep(0.1)
            session.access_token = new_token
            return session

        async def mock_get_session(session_id: str) -> AuthSession | None:
            if refresh_call_count > 0:
                mock_auth_session.oauth_session["access_token"] = new_token
            return mock_auth_session

        async def mock_update_session_tokens(
            session_id: str, oauth_session_data: dict
        ) -> None:
            mock_auth_session.oauth_session.update(oauth_session_data)

        mock_oauth_client = type(
            "MockOAuthClient", (), {"refresh_session": mock_refresh_session}
        )()

        with (
            patch(
                "backend._internal.atproto.client.get_oauth_client",
                return_value=mock_oauth_client,
            ),
            patch(
                "backend._internal.atproto.client.get_session",
                side_effect=mock_get_session,
            ),
            patch(
                "backend._internal.atproto.client.update_session_tokens",
                side_effect=mock_update_session_tokens,
            ),
        ):
            tasks = [
                _refresh_session_tokens(mock_auth_session, mock_oauth_session)
                for _ in range(5)
            ]
            results = await asyncio.gather(*tasks)

            assert all(result.access_token == new_token for result in results)
            assert refresh_call_count == 1

    async def test_refresh_failure_uses_fallback(
        self, mock_auth_session: AuthSession, mock_oauth_session: OAuthSession
    ):
        """test that on refresh failure, retries with reload from DB."""
        new_token = "new-refreshed-token"
        refresh_called = False

        async def mock_refresh_session_fails(
            self, session: OAuthSession
        ) -> OAuthSession:
            nonlocal refresh_called
            refresh_called = True
            await asyncio.sleep(0.05)
            raise Exception("500 server_error from PDS")

        get_session_calls = 0

        async def mock_get_session(session_id: str) -> AuthSession | None:
            nonlocal get_session_calls
            get_session_calls += 1
            if get_session_calls >= 2:
                mock_auth_session.oauth_session["access_token"] = new_token
            return mock_auth_session

        async def mock_update_session_tokens(
            session_id: str, oauth_session_data: dict
        ) -> None:
            mock_auth_session.oauth_session.update(oauth_session_data)

        mock_oauth_client = type(
            "MockOAuthClient", (), {"refresh_session": mock_refresh_session_fails}
        )()

        with (
            patch(
                "backend._internal.atproto.client.get_oauth_client",
                return_value=mock_oauth_client,
            ),
            patch(
                "backend._internal.atproto.client.get_session",
                side_effect=mock_get_session,
            ),
            patch(
                "backend._internal.atproto.client.update_session_tokens",
                side_effect=mock_update_session_tokens,
            ),
        ):
            result = await _refresh_session_tokens(
                mock_auth_session, mock_oauth_session
            )

            assert refresh_called
            assert result.access_token == new_token

    async def test_second_request_skips_refresh_if_already_done(
        self, mock_auth_session: AuthSession, mock_oauth_session: OAuthSession
    ):
        """test that second request sees new token and skips refresh."""
        refresh_call_count = 0
        new_token = "already-refreshed-token"

        async def mock_refresh_session(self, session: OAuthSession) -> OAuthSession:
            nonlocal refresh_call_count
            refresh_call_count += 1
            await asyncio.sleep(0.1)
            session.access_token = new_token
            return session

        get_session_calls = 0

        async def mock_get_session(session_id: str) -> AuthSession | None:
            nonlocal get_session_calls
            get_session_calls += 1
            if get_session_calls > 1:
                mock_auth_session.oauth_session["access_token"] = new_token
            return mock_auth_session

        async def mock_update_session_tokens(
            session_id: str, oauth_session_data: dict
        ) -> None:
            mock_auth_session.oauth_session.update(oauth_session_data)

        mock_oauth_client = type(
            "MockOAuthClient", (), {"refresh_session": mock_refresh_session}
        )()

        with (
            patch(
                "backend._internal.atproto.client.get_oauth_client",
                return_value=mock_oauth_client,
            ),
            patch(
                "backend._internal.atproto.client.get_session",
                side_effect=mock_get_session,
            ),
            patch(
                "backend._internal.atproto.client.update_session_tokens",
                side_effect=mock_update_session_tokens,
            ),
        ):
            result1 = await _refresh_session_tokens(
                mock_auth_session, mock_oauth_session
            )
            assert result1.access_token == new_token

            result2 = await _refresh_session_tokens(
                mock_auth_session, mock_oauth_session
            )
            assert result2.access_token == new_token

            assert refresh_call_count == 1


class TestRefreshLocksCache:
    """test _refresh_locks cache behavior (memory leak prevention)."""

    def test_same_session_returns_same_lock(self):
        """same session_id should return the same lock instance."""
        _refresh_locks.clear()

        _refresh_locks["session-a"] = asyncio.Lock()
        lock1 = _refresh_locks["session-a"]
        lock2 = _refresh_locks["session-a"]

        assert lock1 is lock2

    def test_different_sessions_have_different_locks(self):
        """different session_ids should have different lock instances."""
        _refresh_locks.clear()

        _refresh_locks["session-a"] = asyncio.Lock()
        _refresh_locks["session-b"] = asyncio.Lock()

        assert _refresh_locks["session-a"] is not _refresh_locks["session-b"]

    def test_cache_is_bounded_by_maxsize(self):
        """cache should evict entries when full (LRU behavior)."""
        _refresh_locks.clear()

        assert _refresh_locks.maxsize == 10_000

        for i in range(100):
            _refresh_locks[f"session-{i}"] = asyncio.Lock()

        assert len(_refresh_locks) == 100

    def test_lru_eviction_order(self):
        """LRU cache should evict least recently used entries first."""
        small_cache: LRUCache[str, asyncio.Lock] = LRUCache(maxsize=3)

        small_cache["a"] = asyncio.Lock()
        small_cache["b"] = asyncio.Lock()
        small_cache["c"] = asyncio.Lock()

        _ = small_cache["a"]
        small_cache["d"] = asyncio.Lock()

        assert "a" in small_cache
        assert "b" not in small_cache
        assert "c" in small_cache
        assert "d" in small_cache

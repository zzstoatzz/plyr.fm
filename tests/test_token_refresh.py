"""tests for concurrent token refresh locking."""

import asyncio
from unittest.mock import patch

import pytest
from atproto_oauth.models import OAuthSession

from backend._internal import Session as AuthSession
from backend._internal.atproto.records import _refresh_session_tokens


@pytest.fixture
def mock_auth_session() -> AuthSession:
    """create mock auth session."""
    # generate a real EC key and serialize it
    import cryptography.hazmat.backends
    import cryptography.hazmat.primitives.asymmetric.ec as ec
    from cryptography.hazmat.primitives import serialization

    private_key = ec.generate_private_key(
        ec.SECP256R1(), cryptography.hazmat.backends.default_backend()
    )

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
    # defer cryptography import to avoid overhead
    import cryptography.hazmat.backends
    import cryptography.hazmat.primitives.asymmetric.ec as ec

    # generate a real key for the mock
    private_key = ec.generate_private_key(
        ec.SECP256R1(), cryptography.hazmat.backends.default_backend()
    )

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

    @pytest.mark.asyncio
    async def test_concurrent_refresh_only_calls_once(
        self, mock_auth_session: AuthSession, mock_oauth_session: OAuthSession
    ):
        """test that concurrent refresh attempts only call the OAuth client once."""
        refresh_call_count = 0
        new_token = "new-refreshed-token"

        async def mock_refresh_session(session: OAuthSession) -> OAuthSession:
            """mock OAuth client refresh with delay to simulate race."""
            nonlocal refresh_call_count
            refresh_call_count += 1

            # simulate network delay
            await asyncio.sleep(0.1)

            # return updated session with new token
            session.access_token = new_token
            return session

        async def mock_get_session(session_id: str) -> AuthSession | None:
            """mock get_session that returns updated tokens after first refresh."""
            if refresh_call_count > 0:
                # first refresh completed - return new token
                mock_auth_session.oauth_session["access_token"] = new_token
            return mock_auth_session

        async def mock_update_session_tokens(
            session_id: str, oauth_session_data: dict
        ) -> None:
            """mock session update."""
            mock_auth_session.oauth_session.update(oauth_session_data)

        with (
            patch(
                "backend.atproto.records.oauth_client.refresh_session",
                side_effect=mock_refresh_session,
            ),
            patch(
                "backend.atproto.records.get_session",
                side_effect=mock_get_session,
            ),
            patch(
                "backend.atproto.records.update_session_tokens",
                side_effect=mock_update_session_tokens,
            ),
        ):
            # launch 5 concurrent refresh attempts
            tasks = [
                _refresh_session_tokens(mock_auth_session, mock_oauth_session)
                for _ in range(5)
            ]
            results = await asyncio.gather(*tasks)

            # all should succeed and get the new token
            assert all(result.access_token == new_token for result in results)

            # but OAuth client should only be called once (the lock worked!)
            assert refresh_call_count == 1

    @pytest.mark.asyncio
    async def test_refresh_failure_uses_fallback(
        self, mock_auth_session: AuthSession, mock_oauth_session: OAuthSession
    ):
        """test that on refresh failure, retries with reload from DB."""
        new_token = "new-refreshed-token"
        refresh_called = False

        async def mock_refresh_session_fails(session: OAuthSession) -> OAuthSession:
            """mock refresh that always fails."""
            nonlocal refresh_called
            refresh_called = True
            await asyncio.sleep(0.05)
            raise Exception("500 server_error from PDS")

        get_session_calls = 0

        async def mock_get_session(session_id: str) -> AuthSession | None:
            """mock get_session that returns updated tokens on retry."""
            nonlocal get_session_calls
            get_session_calls += 1

            # on retry (after failure), return new tokens as if another request succeeded
            if get_session_calls >= 2:
                mock_auth_session.oauth_session["access_token"] = new_token

            return mock_auth_session

        async def mock_update_session_tokens(
            session_id: str, oauth_session_data: dict
        ) -> None:
            """mock session update."""
            mock_auth_session.oauth_session.update(oauth_session_data)

        with (
            patch(
                "backend.atproto.records.oauth_client.refresh_session",
                side_effect=mock_refresh_session_fails,
            ),
            patch(
                "backend.atproto.records.get_session",
                side_effect=mock_get_session,
            ),
            patch(
                "backend.atproto.records.update_session_tokens",
                side_effect=mock_update_session_tokens,
            ),
        ):
            # this should fail to refresh but succeed via fallback
            result = await _refresh_session_tokens(
                mock_auth_session, mock_oauth_session
            )

            # verify it tried to refresh
            assert refresh_called

            # verify it fell back to reloaded tokens
            assert result.access_token == new_token

    @pytest.mark.asyncio
    async def test_second_request_skips_refresh_if_already_done(
        self, mock_auth_session: AuthSession, mock_oauth_session: OAuthSession
    ):
        """test that second request sees new token and skips refresh."""
        refresh_call_count = 0
        new_token = "already-refreshed-token"

        async def mock_refresh_session(session: OAuthSession) -> OAuthSession:
            """mock OAuth client refresh."""
            nonlocal refresh_call_count
            refresh_call_count += 1
            await asyncio.sleep(0.1)
            session.access_token = new_token
            return session

        get_session_calls = 0

        async def mock_get_session(session_id: str) -> AuthSession | None:
            """mock get_session that simulates first refresh completing quickly."""
            nonlocal get_session_calls
            get_session_calls += 1

            # on second+ call, act like refresh already happened
            if get_session_calls > 1:
                mock_auth_session.oauth_session["access_token"] = new_token

            return mock_auth_session

        async def mock_update_session_tokens(
            session_id: str, oauth_session_data: dict
        ) -> None:
            """mock session update."""
            mock_auth_session.oauth_session.update(oauth_session_data)

        with (
            patch(
                "backend.atproto.records.oauth_client.refresh_session",
                side_effect=mock_refresh_session,
            ),
            patch(
                "backend.atproto.records.get_session",
                side_effect=mock_get_session,
            ),
            patch(
                "backend.atproto.records.update_session_tokens",
                side_effect=mock_update_session_tokens,
            ),
        ):
            # first refresh
            result1 = await _refresh_session_tokens(
                mock_auth_session, mock_oauth_session
            )
            assert result1.access_token == new_token

            # second refresh attempt should skip network call
            result2 = await _refresh_session_tokens(
                mock_auth_session, mock_oauth_session
            )
            assert result2.access_token == new_token

            # OAuth client should have been called exactly once
            assert refresh_call_count == 1

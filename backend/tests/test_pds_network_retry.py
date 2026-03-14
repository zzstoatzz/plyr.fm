"""tests for PDS network error retry in make_pds_request and upload_blob."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request, upload_blob


@pytest.fixture
def mock_auth_session() -> AuthSession:
    """create mock auth session with valid OAuth data."""
    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    dpop_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    return AuthSession(
        session_id="test-session",
        did="did:plc:testgoose",
        handle="goose.art",
        oauth_session={
            "did": "did:plc:testgoose",
            "handle": "goose.art",
            "pds_url": "https://selfhosted.social",
            "authserver_iss": "https://selfhosted.social",
            "scope": "atproto transition:generic",
            "access_token": "test-token",
            "refresh_token": "test-refresh",
            "dpop_private_key_pem": dpop_key_pem,
            "dpop_authserver_nonce": "nonce1",
            "dpop_pds_nonce": "nonce2",
        },
    )


def _mock_response(status_code: int = 200, json_data: dict | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = "ok"
    return resp


class TestMakePdsRequestNetworkRetry:
    """make_pds_request retries on transient network errors."""

    async def test_retries_on_read_error_then_succeeds(
        self, mock_auth_session: AuthSession
    ) -> None:
        ok_response = _mock_response(
            200, {"uri": "at://did:plc:testgoose/fm.plyr.track/abc"}
        )
        mock_client = AsyncMock()
        mock_client.make_authenticated_request = AsyncMock(
            side_effect=[httpx.ReadError(""), ok_response]
        )

        with patch(
            "backend._internal.atproto.client.get_oauth_client",
            return_value=mock_client,
        ):
            result = await make_pds_request(
                mock_auth_session,
                "POST",
                "com.atproto.repo.createRecord",
                payload={"repo": "did:plc:testgoose"},
            )

        assert result == {"uri": "at://did:plc:testgoose/fm.plyr.track/abc"}
        assert mock_client.make_authenticated_request.call_count == 2

    async def test_raises_after_two_read_errors(
        self, mock_auth_session: AuthSession
    ) -> None:
        mock_client = AsyncMock()
        mock_client.make_authenticated_request = AsyncMock(
            side_effect=httpx.ReadError("")
        )

        with (
            patch(
                "backend._internal.atproto.client.get_oauth_client",
                return_value=mock_client,
            ),
            pytest.raises(Exception, match="PDS request failed after retry"),
        ):
            await make_pds_request(
                mock_auth_session,
                "POST",
                "com.atproto.repo.createRecord",
            )

    async def test_retries_on_connect_error(
        self, mock_auth_session: AuthSession
    ) -> None:
        ok_response = _mock_response(200, {"uri": "at://test"})
        mock_client = AsyncMock()
        mock_client.make_authenticated_request = AsyncMock(
            side_effect=[httpx.ConnectError("connection reset"), ok_response]
        )

        with patch(
            "backend._internal.atproto.client.get_oauth_client",
            return_value=mock_client,
        ):
            result = await make_pds_request(
                mock_auth_session,
                "GET",
                "com.atproto.repo.getRecord",
            )

        assert result == {"uri": "at://test"}


class TestUploadBlobNetworkRetry:
    """upload_blob retries on transient network errors."""

    async def test_retries_on_read_error_then_succeeds(
        self, mock_auth_session: AuthSession
    ) -> None:
        blob_ref = {
            "$type": "blob",
            "ref": {"$link": "bafytest"},
            "mimeType": "audio/mpeg",
            "size": 1024,
        }
        ok_response = _mock_response(200, {"blob": blob_ref})
        mock_client = AsyncMock()
        mock_client.make_authenticated_request = AsyncMock(
            side_effect=[httpx.ReadError(""), ok_response]
        )

        with patch(
            "backend._internal.atproto.client.get_oauth_client",
            return_value=mock_client,
        ):
            result = await upload_blob(mock_auth_session, b"fake-audio", "audio/mpeg")

        assert result == blob_ref
        assert mock_client.make_authenticated_request.call_count == 2

    async def test_raises_after_two_read_errors(
        self, mock_auth_session: AuthSession
    ) -> None:
        mock_client = AsyncMock()
        mock_client.make_authenticated_request = AsyncMock(
            side_effect=httpx.ReadError("")
        )

        with (
            patch(
                "backend._internal.atproto.client.get_oauth_client",
                return_value=mock_client,
            ),
            pytest.raises(Exception, match="blob upload failed after retry"),
        ):
            await upload_blob(mock_auth_session, b"fake-audio", "audio/mpeg")

    async def test_does_not_retry_payload_too_large(
        self, mock_auth_session: AuthSession
    ) -> None:
        response_413 = _mock_response(413)
        response_413.text = "payload too large"
        mock_client = AsyncMock()
        mock_client.make_authenticated_request = AsyncMock(return_value=response_413)

        with (
            patch(
                "backend._internal.atproto.client.get_oauth_client",
                return_value=mock_client,
            ),
            pytest.raises(Exception, match="blob too large"),
        ):
            await upload_blob(mock_auth_session, b"huge-audio", "audio/mpeg")

        assert mock_client.make_authenticated_request.call_count == 1

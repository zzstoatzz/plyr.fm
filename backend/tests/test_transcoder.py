"""tests for transcoder client."""

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest

from backend._internal.transcoder_client import (
    TranscoderClient,
    get_transcoder_client,
)


@pytest.fixture
def transcoder_client() -> TranscoderClient:
    """test transcoder client with mock settings."""
    return TranscoderClient(
        service_url="https://test-transcoder.example.com",
        auth_token="test-token",
        timeout_seconds=30,
        target_format="mp3",
    )


@pytest.fixture
def temp_audio_file() -> Path:
    """create a temporary audio file for testing."""
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".aiff", delete=False) as f:
        # write some fake audio data
        f.write(b"FORM" + b"\x00" * 100)
        return Path(f.name)


async def test_transcoder_client_success(
    transcoder_client: TranscoderClient, temp_audio_file: Path
) -> None:
    """test TranscoderClient.transcode_file() with successful response."""
    mock_response = Mock()
    mock_response.content = b"transcoded mp3 data"
    mock_response.headers = {"content-type": "audio/mpeg"}
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        result = await transcoder_client.transcode_file(temp_audio_file, "aiff")

    assert result.success is True
    assert result.data == b"transcoded mp3 data"
    assert result.content_type == "audio/mpeg"
    assert result.error is None
    mock_post.assert_called_once()

    # verify the call included auth header
    call_kwargs = mock_post.call_args.kwargs
    assert call_kwargs["headers"] == {"X-Transcoder-Key": "test-token"}
    assert call_kwargs["params"] == {"target": "mp3"}

    # cleanup
    temp_audio_file.unlink(missing_ok=True)


async def test_transcoder_client_timeout(
    transcoder_client: TranscoderClient, temp_audio_file: Path
) -> None:
    """test TranscoderClient.transcode_file() timeout handling."""
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.TimeoutException("timeout")

        result = await transcoder_client.transcode_file(temp_audio_file, "aiff")

    assert result.success is False
    assert result.data is None
    assert result.error is not None
    assert "timed out" in result.error

    # cleanup
    temp_audio_file.unlink(missing_ok=True)


async def test_transcoder_client_http_error(
    transcoder_client: TranscoderClient, temp_audio_file: Path
) -> None:
    """test TranscoderClient.transcode_file() HTTP error handling."""
    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=Mock(),
            response=mock_response,
        )

        result = await transcoder_client.transcode_file(temp_audio_file, "aiff")

    assert result.success is False
    assert result.data is None
    assert result.error is not None
    assert "500" in result.error
    assert "Internal Server Error" in result.error

    # cleanup
    temp_audio_file.unlink(missing_ok=True)


async def test_transcoder_client_unexpected_error(
    transcoder_client: TranscoderClient, temp_audio_file: Path
) -> None:
    """test TranscoderClient.transcode_file() unexpected error handling."""
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = RuntimeError("unexpected error")

        result = await transcoder_client.transcode_file(temp_audio_file, "aiff")

    assert result.success is False
    assert result.data is None
    assert result.error is not None
    assert "unexpected" in result.error.lower()

    # cleanup
    temp_audio_file.unlink(missing_ok=True)


async def test_transcoder_client_custom_target_format(
    transcoder_client: TranscoderClient, temp_audio_file: Path
) -> None:
    """test TranscoderClient.transcode_file() with custom target format."""
    mock_response = Mock()
    mock_response.content = b"transcoded aac data"
    mock_response.headers = {"content-type": "audio/aac"}
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        result = await transcoder_client.transcode_file(
            temp_audio_file, "flac", target_format="aac"
        )

    assert result.success is True
    call_kwargs = mock_post.call_args.kwargs
    assert call_kwargs["params"] == {"target": "aac"}

    # cleanup
    temp_audio_file.unlink(missing_ok=True)


def test_transcoder_client_from_settings() -> None:
    """test TranscoderClient.from_settings() creates client correctly."""
    with patch("backend._internal.transcoder_client.settings") as mock_settings:
        mock_settings.transcoder.service_url = "https://transcoder.example.com"
        mock_settings.transcoder.auth_token = "secret-token"
        mock_settings.transcoder.timeout_seconds = 120
        mock_settings.transcoder.target_format = "mp3"

        client = TranscoderClient.from_settings()

    assert client.service_url == "https://transcoder.example.com"
    assert client.auth_token == "secret-token"
    assert client.target_format == "mp3"


def test_get_transcoder_client_singleton() -> None:
    """test get_transcoder_client() returns singleton."""
    import backend._internal.transcoder_client as module

    # reset singleton
    module._client = None

    with patch("backend._internal.transcoder_client.settings") as mock_settings:
        mock_settings.transcoder.service_url = "https://transcoder.example.com"
        mock_settings.transcoder.auth_token = "token"
        mock_settings.transcoder.timeout_seconds = 60
        mock_settings.transcoder.target_format = "mp3"

        client1 = get_transcoder_client()
        client2 = get_transcoder_client()

    assert client1 is client2

    # cleanup
    module._client = None

"""tests for transcoder client."""

import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

import httpx
import pytest

from backend._internal.clients.transcoder import (
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


@pytest.fixture
def temp_output_file() -> Path:
    """destination path for transcoded output."""
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        return Path(f.name)


def _make_streaming_response(
    chunks: list[bytes], headers: dict[str, str] | None = None
) -> tuple[Mock, Any]:
    """build a mock that mimics httpx's streaming response context manager."""
    response = Mock()
    response.headers = headers or {"content-type": "audio/mpeg"}
    response.raise_for_status.return_value = None

    async def aiter_bytes() -> AsyncIterator[bytes]:
        for chunk in chunks:
            yield chunk

    response.aiter_bytes = aiter_bytes

    @asynccontextmanager
    async def cm(*_args: Any, **_kwargs: Any) -> AsyncIterator[Mock]:
        yield response

    return response, cm


async def test_transcoder_client_success(
    transcoder_client: TranscoderClient,
    temp_audio_file: Path,
    temp_output_file: Path,
) -> None:
    """successful transcode streams the response body to output_path."""
    _response, stream_cm = _make_streaming_response(
        [b"transcoded ", b"mp3 data"], {"content-type": "audio/mpeg"}
    )

    with patch("httpx.AsyncClient.stream", side_effect=stream_cm):
        result = await transcoder_client.transcode_file(
            temp_audio_file, "aiff", output_path=temp_output_file
        )

    assert result.success is True
    assert result.output_path == temp_output_file
    assert result.output_size == len(b"transcoded mp3 data")
    assert result.content_type == "audio/mpeg"
    assert result.error is None
    assert temp_output_file.read_bytes() == b"transcoded mp3 data"

    temp_audio_file.unlink(missing_ok=True)
    temp_output_file.unlink(missing_ok=True)


async def test_transcoder_client_timeout(
    transcoder_client: TranscoderClient,
    temp_audio_file: Path,
    temp_output_file: Path,
) -> None:
    """timeout during transcode is surfaced as an error."""
    with patch(
        "httpx.AsyncClient.stream", side_effect=httpx.TimeoutException("timeout")
    ):
        result = await transcoder_client.transcode_file(
            temp_audio_file, "aiff", output_path=temp_output_file
        )

    assert result.success is False
    assert result.output_path is None
    assert result.error is not None
    assert "timed out" in result.error

    temp_audio_file.unlink(missing_ok=True)
    temp_output_file.unlink(missing_ok=True)


async def test_transcoder_client_http_error(
    transcoder_client: TranscoderClient,
    temp_audio_file: Path,
    temp_output_file: Path,
) -> None:
    """HTTP error during transcode is surfaced as an error."""
    mock_response = Mock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"

    with patch(
        "httpx.AsyncClient.stream",
        side_effect=httpx.HTTPStatusError(
            "Server Error",
            request=Mock(),
            response=mock_response,
        ),
    ):
        result = await transcoder_client.transcode_file(
            temp_audio_file, "aiff", output_path=temp_output_file
        )

    assert result.success is False
    assert result.output_path is None
    assert result.error is not None
    assert "500" in result.error
    assert "Internal Server Error" in result.error

    temp_audio_file.unlink(missing_ok=True)
    temp_output_file.unlink(missing_ok=True)


async def test_transcoder_client_unexpected_error(
    transcoder_client: TranscoderClient,
    temp_audio_file: Path,
    temp_output_file: Path,
) -> None:
    """unexpected exceptions are caught and surfaced as errors."""
    with patch(
        "httpx.AsyncClient.stream", side_effect=RuntimeError("unexpected error")
    ):
        result = await transcoder_client.transcode_file(
            temp_audio_file, "aiff", output_path=temp_output_file
        )

    assert result.success is False
    assert result.output_path is None
    assert result.error is not None
    assert "unexpected" in result.error.lower()

    temp_audio_file.unlink(missing_ok=True)
    temp_output_file.unlink(missing_ok=True)


async def test_transcoder_client_custom_target_format(
    transcoder_client: TranscoderClient,
    temp_audio_file: Path,
    temp_output_file: Path,
) -> None:
    """custom target_format is passed through as a query param."""
    captured: dict[str, Any] = {}

    @asynccontextmanager
    async def stream_cm(method: str, url: str, **kwargs: Any) -> AsyncIterator[Mock]:
        captured["method"] = method
        captured["url"] = url
        captured.update(kwargs)
        response = Mock()
        response.headers = {"content-type": "audio/aac"}
        response.raise_for_status.return_value = None

        async def aiter_bytes() -> AsyncIterator[bytes]:
            yield b"transcoded aac data"

        response.aiter_bytes = aiter_bytes
        yield response

    with patch("httpx.AsyncClient.stream", side_effect=stream_cm):
        result = await transcoder_client.transcode_file(
            temp_audio_file, "flac", output_path=temp_output_file, target_format="aac"
        )

    assert result.success is True
    assert captured["params"] == {"target": "aac"}

    temp_audio_file.unlink(missing_ok=True)
    temp_output_file.unlink(missing_ok=True)


def test_transcoder_client_from_settings() -> None:
    """test TranscoderClient.from_settings() creates client correctly."""
    with patch("backend._internal.clients.transcoder.settings") as mock_settings:
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
    import backend._internal.clients.transcoder as module

    # reset singleton
    module._client = None

    with patch("backend._internal.clients.transcoder.settings") as mock_settings:
        mock_settings.transcoder.service_url = "https://transcoder.example.com"
        mock_settings.transcoder.auth_token = "token"
        mock_settings.transcoder.timeout_seconds = 60
        mock_settings.transcoder.target_format = "mp3"

        client1 = get_transcoder_client()
        client2 = get_transcoder_client()

    assert client1 is client2

    # cleanup
    module._client = None

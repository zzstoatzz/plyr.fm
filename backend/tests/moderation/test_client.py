"""tests for ModerationClient methods."""

from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest

from backend._internal.clients.moderation import ModerationClient


async def test_moderation_client_scan_success() -> None:
    """test ModerationClient.scan() with successful response."""
    mock_response = Mock()
    mock_response.json.return_value = {
        "is_flagged": True,
        "highest_score": 85,
        "matches": [{"artist": "Test", "title": "Song", "score": 85}],
        "raw_response": {"status": "success"},
    }
    mock_response.raise_for_status.return_value = None

    client = ModerationClient(
        service_url="https://test.example.com",
        labeler_url="https://labeler.example.com",
        auth_token="test-token",
        timeout_seconds=30,
        label_cache_prefix="test:label:",
        label_cache_ttl_seconds=300,
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        result = await client.scan("https://example.com/audio.mp3")

    assert result.is_flagged is True
    assert result.highest_score == 85
    assert len(result.matches) == 1
    mock_post.assert_called_once()


async def test_moderation_client_scan_timeout() -> None:
    """test ModerationClient.scan() timeout handling."""
    client = ModerationClient(
        service_url="https://test.example.com",
        labeler_url="https://labeler.example.com",
        auth_token="test-token",
        timeout_seconds=30,
        label_cache_prefix="test:label:",
        label_cache_ttl_seconds=300,
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.TimeoutException("timeout")

        with pytest.raises(httpx.TimeoutException):
            await client.scan("https://example.com/audio.mp3")


async def test_moderation_client_get_sensitive_images() -> None:
    """test ModerationClient.get_sensitive_images() with successful response."""
    mock_response = Mock()
    mock_response.json.return_value = {
        "image_ids": ["abc123", "def456"],
        "urls": ["https://example.com/image.jpg"],
    }
    mock_response.raise_for_status.return_value = None

    client = ModerationClient(
        service_url="https://test.example.com",
        labeler_url="https://labeler.example.com",
        auth_token="test-token",
        timeout_seconds=30,
        label_cache_prefix="test:label:",
        label_cache_ttl_seconds=300,
    )

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response

        result = await client.get_sensitive_images()

    assert result.image_ids == ["abc123", "def456"]
    assert result.urls == ["https://example.com/image.jpg"]
    mock_get.assert_called_once()


async def test_moderation_client_get_sensitive_images_empty() -> None:
    """test ModerationClient.get_sensitive_images() with empty response."""
    mock_response = Mock()
    mock_response.json.return_value = {"image_ids": [], "urls": []}
    mock_response.raise_for_status.return_value = None

    client = ModerationClient(
        service_url="https://test.example.com",
        labeler_url="https://labeler.example.com",
        auth_token="test-token",
        timeout_seconds=30,
        label_cache_prefix="test:label:",
        label_cache_ttl_seconds=300,
    )

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_response

        result = await client.get_sensitive_images()

    assert result.image_ids == []
    assert result.urls == []

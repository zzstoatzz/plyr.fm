"""tests for constellation client."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal.constellation import get_like_count, get_like_count_safe


@pytest.fixture
def mock_settings():
    """mock settings with like_collection."""
    with patch("backend._internal.constellation.settings") as mock:
        mock.atproto.like_collection = "fm.plyr.dev.like"
        yield mock


class TestGetLikeCount:
    """tests for get_like_count."""

    async def test_returns_count_from_response(self, mock_settings):
        """should return count from constellation response."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"count": 42}
        mock_response.raise_for_status = MagicMock()

        with patch("backend._internal.constellation.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await get_like_count("at://did:plc:xxx/fm.plyr.track/abc")

            assert result == 42

    async def test_calls_correct_endpoint(self, mock_settings):
        """should call constellation with correct params."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"count": 0}
        mock_response.raise_for_status = MagicMock()

        with patch("backend._internal.constellation.httpx.AsyncClient") as mock_client:
            mock_get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.get = mock_get

            await get_like_count("at://did:plc:xxx/fm.plyr.track/abc")

            mock_get.assert_called_once_with(
                "https://constellation.microcosm.blue/links/count",
                params={
                    "target": "at://did:plc:xxx/fm.plyr.track/abc",
                    "collection": "fm.plyr.dev.like",
                    "path": ".subject.uri",
                },
            )

    async def test_raises_on_http_error(self, mock_settings):
        """should raise when constellation returns error."""
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = Exception("500 error")

        with patch("backend._internal.constellation.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            with pytest.raises(Exception, match="500 error"):
                await get_like_count("at://did:plc:xxx/fm.plyr.track/abc")


class TestGetLikeCountSafe:
    """tests for get_like_count_safe."""

    async def test_returns_count_on_success(self, mock_settings):
        """should return count when successful."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"count": 10}
        mock_response.raise_for_status = MagicMock()

        with patch("backend._internal.constellation.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            result = await get_like_count_safe("at://did:plc:xxx/fm.plyr.track/abc")

            assert result == 10

    async def test_returns_fallback_on_error(self, mock_settings):
        """should return fallback when constellation fails."""
        with patch("backend._internal.constellation.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("connection failed")
            )

            result = await get_like_count_safe(
                "at://did:plc:xxx/fm.plyr.track/abc", fallback=99
            )

            assert result == 99

    async def test_default_fallback_is_zero(self, mock_settings):
        """should default to 0 fallback."""
        with patch("backend._internal.constellation.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=Exception("connection failed")
            )

            result = await get_like_count_safe("at://did:plc:xxx/fm.plyr.track/abc")

            assert result == 0

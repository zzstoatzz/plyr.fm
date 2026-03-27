"""tests for sensitive images endpoint."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend._internal.clients.moderation import SensitiveImagesResult


async def test_get_sensitive_images_endpoint(
    client: TestClient,
) -> None:
    """test GET /moderation/sensitive-images endpoint proxies to moderation service."""
    mock_result = SensitiveImagesResult(
        image_ids=["image1", "image2"],
        urls=["https://example.com/avatar.jpg"],
    )

    with patch("backend.api.moderation.get_moderation_client") as mock_get_client:
        mock_client = AsyncMock()
        mock_client.get_sensitive_images.return_value = mock_result
        mock_get_client.return_value = mock_client

        response = client.get("/moderation/sensitive-images")

    assert response.status_code == 200
    data = response.json()
    assert data["image_ids"] == ["image1", "image2"]
    assert data["urls"] == ["https://example.com/avatar.jpg"]

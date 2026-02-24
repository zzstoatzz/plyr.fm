"""tests for POST /moderation/reports endpoint."""

from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend._internal import require_auth
from backend._internal.clients.moderation import CreateReportResult
from backend.main import app


async def test_create_report_success(report_test_app: FastAPI) -> None:
    """test successful report submission."""
    mock_result = CreateReportResult(report_id=123)

    with patch("backend.api.moderation.get_moderation_client") as mock_get_client:
        mock_client = AsyncMock()
        mock_client.create_report.return_value = mock_result
        mock_get_client.return_value = mock_client

        async with AsyncClient(
            transport=ASGITransport(app=report_test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/moderation/reports",
                json={
                    "target_type": "track",
                    "target_id": "42",
                    "reason": "spam",
                    "description": "test report",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["report_id"] == 123


async def test_create_report_requires_auth() -> None:
    """test that report submission requires authentication."""
    # clear any auth overrides
    app.dependency_overrides.pop(require_auth, None)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/moderation/reports",
            json={
                "target_type": "track",
                "target_id": "42",
                "reason": "spam",
            },
        )

    assert response.status_code == 401


async def test_create_report_moderation_service_auth_error(
    report_test_app: FastAPI,
) -> None:
    """test 503 when moderation service returns 401 (auth misconfiguration)."""
    mock_response = Mock()
    mock_response.status_code = 401
    mock_response.text = "Unauthorized"

    with patch("backend.api.moderation.get_moderation_client") as mock_get_client:
        mock_client = AsyncMock()
        mock_client.create_report.side_effect = httpx.HTTPStatusError(
            "401 Unauthorized",
            request=Mock(),
            response=mock_response,
        )
        mock_get_client.return_value = mock_client

        async with AsyncClient(
            transport=ASGITransport(app=report_test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/moderation/reports",
                json={
                    "target_type": "track",
                    "target_id": "42",
                    "reason": "abuse",
                },
            )

    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


async def test_create_report_moderation_service_not_found(
    report_test_app: FastAPI,
) -> None:
    """test 503 when moderation service returns 404 (endpoint not deployed)."""
    mock_response = Mock()
    mock_response.status_code = 404
    mock_response.text = "Not Found"

    with patch("backend.api.moderation.get_moderation_client") as mock_get_client:
        mock_client = AsyncMock()
        mock_client.create_report.side_effect = httpx.HTTPStatusError(
            "404 Not Found",
            request=Mock(),
            response=mock_response,
        )
        mock_get_client.return_value = mock_client

        async with AsyncClient(
            transport=ASGITransport(app=report_test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/moderation/reports",
                json={
                    "target_type": "track",
                    "target_id": "42",
                    "reason": "copyright",
                },
            )

    assert response.status_code == 503
    assert "not found" in response.json()["detail"]


async def test_create_report_moderation_service_timeout(
    report_test_app: FastAPI,
) -> None:
    """test 503 when moderation service times out."""
    with patch("backend.api.moderation.get_moderation_client") as mock_get_client:
        mock_client = AsyncMock()
        mock_client.create_report.side_effect = httpx.TimeoutException("timeout")
        mock_get_client.return_value = mock_client

        async with AsyncClient(
            transport=ASGITransport(app=report_test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/moderation/reports",
                json={
                    "target_type": "artist",
                    "target_id": "did:plc:test",
                    "reason": "other",
                },
            )

    assert response.status_code == 503
    assert "timeout" in response.json()["detail"]


async def test_create_report_invalid_reason(report_test_app: FastAPI) -> None:
    """test validation error for invalid reason."""
    async with AsyncClient(
        transport=ASGITransport(app=report_test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/moderation/reports",
            json={
                "target_type": "track",
                "target_id": "42",
                "reason": "invalid_reason",
            },
        )

    assert response.status_code == 422  # validation error

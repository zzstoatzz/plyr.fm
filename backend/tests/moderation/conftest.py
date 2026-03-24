"""shared fixtures for moderation tests."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI

from backend._internal import Session, require_auth
from backend._internal.clients.moderation import ScanResult
from backend.main import app


@pytest.fixture
def mock_scan_result() -> ScanResult:
    """typical scan result from moderation client."""
    return ScanResult(
        is_flagged=True,
        highest_score=85,
        matches=[
            {
                "artist": "Test Artist",
                "title": "Test Song",
                "score": 85,
                "isrc": "USRC12345678",
            }
        ],
        raw_response={
            "status": "success",
            "result": [],
            "dominant_match_pct": 85,
            "dominant_match": {"artist": "Test Artist", "title": "Test Song"},
        },
    )


@pytest.fixture
def mock_clear_result() -> ScanResult:
    """scan result when no copyright matches found."""
    return ScanResult(
        is_flagged=False,
        highest_score=0,
        matches=[],
        raw_response={"status": "success", "result": None},
    )


class MockReportSession(Session):
    """mock session for report endpoint tests."""

    def __init__(self, did: str = "did:test:reporter123"):
        self.did = did
        self.handle = "reporter.bsky.social"
        self.session_id = "test_session_id"


@pytest.fixture
def report_test_app() -> Generator[FastAPI, None, None]:
    """create test app with mocked auth for report tests."""

    async def mock_require_auth() -> Session:
        return MockReportSession()

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()

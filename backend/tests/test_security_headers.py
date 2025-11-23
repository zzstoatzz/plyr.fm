"""test security headers middleware."""

from fastapi.testclient import TestClient

from backend.config import settings


def test_security_headers_present(client: TestClient):
    """verify that security headers are present in responses."""
    response = client.get("/health")
    assert response.status_code == 200

    headers = response.headers

    # check basic security headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["X-XSS-Protection"] == "1; mode=block"
    assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_hsts_header_logic(client: TestClient):
    """verify HSTS header logic based on debug mode."""
    # save original setting
    original_debug = settings.app.debug

    try:
        # case 1: debug=True (default in tests) -> no HSTS
        settings.app.debug = True
        response = client.get("/health")
        assert "Strict-Transport-Security" not in response.headers

        # case 2: debug=False (production) -> HSTS present
        settings.app.debug = False
        response = client.get("/health")
        assert (
            response.headers["Strict-Transport-Security"]
            == "max-age=31536000; includeSubDomains"
        )

    finally:
        # restore setting
        settings.app.debug = original_debug

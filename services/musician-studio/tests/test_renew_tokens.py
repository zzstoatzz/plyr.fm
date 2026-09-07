from datetime import UTC, datetime

import httpx
import pytest

from renew_tokens import authorize, expiration


def test_expiration_uses_the_current_tokens_effective_expiry() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer abcdefgh-test"
        return httpx.Response(
            200,
            json={
                "tokens": [
                    {"session_id": "abcdefgh", "expires_at": "2026-10-06T07:00:00Z"},
                    {"session_id": "another!", "expires_at": None},
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert expiration(client, "abcdefgh-test") == datetime(
            2026, 10, 6, 7, tzinfo=UTC
        )


def test_authorize_rejects_another_host_before_sending_password() -> None:
    with (
        httpx.Client() as client,
        pytest.raises(ValueError, match="authorization host"),
    ):
        authorize(client, {}, "https://example.com/oauth/authorize?request_uri=test")


def test_authorize_exchanges_the_callback_without_following_external_redirects() -> (
    None
):
    paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/oauth/authorize":
            return httpx.Response(
                200,
                json={"redirect_uri": "https://api.plyr.fm/auth/callback?code=test"},
            )
        if request.url.path == "/auth/callback":
            return httpx.Response(
                302,
                headers={"location": "https://plyr.fm/?exchange_token=test-exchange"},
            )
        assert request.url.path == "/auth/exchange"
        return httpx.Response(200, json={"session_id": "test-session"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert (
            authorize(
                client,
                {"handle": "test", "password": "fake"},
                "https://pds.zat.dev/oauth/authorize?request_uri=test",
            )
            == "test-session"
        )
    assert paths == ["/oauth/authorize", "/auth/callback", "/auth/exchange"]

"""OAuth PAR is retried on transient authserver failures (sign-in flakiness).

a slow/flaky PDS /oauth/par (e.g. httpx.ReadTimeout) was dumping users to a hard
"sign-in failed" / "could not start approval" error on the first hiccup. PAR is
safe to retry (fresh request_uri per attempt), so a single transient blip should
recover transparently — while a non-transient error still surfaces immediately.
"""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from atproto_oauth.client import OAuthClient

from backend._internal.auth import oauth


def _client(side_effect):
    # MagicMock(spec=OAuthClient) so beartype's isinstance check on the helper's
    # `client: OAuthClient` param passes; left un-annotated so the type checker
    # sees the mock's dynamic attrs (await_count) rather than the real method.
    client = MagicMock(spec=OAuthClient)
    client.start_authorization = AsyncMock(side_effect=side_effect)
    return client


async def test_par_retry_recovers_after_transient_timeouts():
    client = _client(
        [httpx.ReadTimeout(""), httpx.ReadTimeout(""), ("https://pds.test/auth", "st")]
    )
    url, state = await oauth._start_authorization_with_retry(client, "u.test", None)
    assert (url, state) == ("https://pds.test/auth", "st")
    assert client.start_authorization.await_count == 3  # 2 timeouts + 1 success


async def test_par_retry_gives_up_after_budget():
    client = _client(httpx.ReadTimeout(""))  # raises every attempt
    with pytest.raises(httpx.ReadTimeout):
        await oauth._start_authorization_with_retry(client, "u.test", None)
    assert client.start_authorization.await_count == oauth._OAUTH_START_ATTEMPTS


async def test_par_retry_does_not_swallow_non_transient():
    # a non-transient error (e.g. invalid_scope) must surface immediately
    client = _client(ValueError("invalid_scope"))
    with pytest.raises(ValueError, match="invalid_scope"):
        await oauth._start_authorization_with_retry(client, "u.test", None)
    assert client.start_authorization.await_count == 1

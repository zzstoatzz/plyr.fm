"""Rate limits must be per client, not per site.

The bug these pin: the key was `request.client.host`, which behind Fly's proxy
is the proxy. Every user shared one bucket, so a single caller could exhaust the
site's budget -- 298 429s on /radio/state, from listeners polling every 30s and
knocking each other offline.
"""

from starlette.requests import Request

from backend.utilities.rate_limit import client_ip, rate_limit_key


def _request(
    headers: dict[str, str] | None = None, *, peer: str = "172.16.7.50"
) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": raw,
            "client": (peer, 1234),
            "scheme": "https",
            "server": ("api.plyr.fm", 443),
            "query_string": b"",
        }
    )


def test_two_anonymous_callers_get_different_keys() -> None:
    """The whole point: distinct clients must not share a bucket."""
    a = rate_limit_key(_request({"Fly-Client-IP": "203.0.113.10"}))
    b = rate_limit_key(_request({"Fly-Client-IP": "198.51.100.20"}))
    assert a != b


def test_the_proxy_address_is_not_the_key() -> None:
    """Both requests arrive from the same Fly proxy; that must not merge them."""
    a = rate_limit_key(_request({"Fly-Client-IP": "203.0.113.10"}, peer="172.16.7.50"))
    b = rate_limit_key(_request({"Fly-Client-IP": "198.51.100.20"}, peer="172.16.7.50"))
    assert "172.16.7.50" not in a
    assert a != b


def test_session_beats_ip_so_authenticated_users_are_keyed_by_identity() -> None:
    """An authenticated request should never be keyed on its network address.

    Two requests from the same session on different networks are one caller.
    """
    home = rate_limit_key(
        _request({"Cookie": "session_id=abc123", "Fly-Client-IP": "203.0.113.10"})
    )
    cafe = rate_limit_key(
        _request({"Cookie": "session_id=abc123", "Fly-Client-IP": "198.51.100.20"})
    )
    assert home == cafe
    assert "203.0.113" not in home


def test_sharing_a_network_does_not_share_a_budget_when_signed_in() -> None:
    """Two people behind one NAT must not throttle each other."""
    one = rate_limit_key(
        _request({"Cookie": "session_id=aaa", "Fly-Client-IP": "203.0.113.10"})
    )
    two = rate_limit_key(
        _request({"Cookie": "session_id=bbb", "Fly-Client-IP": "203.0.113.10"})
    )
    assert one != two


def test_bearer_tokens_are_keyed_separately() -> None:
    a = rate_limit_key(_request({"Authorization": "Bearer aaa"}))
    b = rate_limit_key(_request({"Authorization": "Bearer bbb"}))
    assert a != b


def test_credentials_are_never_used_raw_as_a_key() -> None:
    """Redis keys are not a place to put a bearer credential."""
    key = rate_limit_key(_request({"Cookie": "session_id=super-secret-value"}))
    assert "super-secret-value" not in key
    token = rate_limit_key(_request({"Authorization": "Bearer super-secret-token"}))
    assert "super-secret-token" not in token


def test_forwarded_for_uses_the_leftmost_entry() -> None:
    """The client is first; the rest are proxies that must not become the key."""
    ip = client_ip(
        _request({"X-Forwarded-For": "203.0.113.10, 70.41.3.18, 150.172.238.178"})
    )
    assert ip == "203.0.113.10"


def test_fly_header_wins_over_forwarded_for() -> None:
    """X-Forwarded-For is client-settable; Fly's own header is not."""
    ip = client_ip(
        _request({"Fly-Client-IP": "203.0.113.10", "X-Forwarded-For": "1.2.3.4"})
    )
    assert ip == "203.0.113.10"

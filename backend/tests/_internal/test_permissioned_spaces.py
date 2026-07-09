"""unit tests for the permissioned-data spaces foundation (#1528).

pure-logic + mocked-PDS-boundary tests for capability detection, ats:// URI
helpers, the OAuth scope composition, and space-credential caching/renewal. the
full data path is exercised against a live ZDS by scripts/permissioned_smoke.py.
"""

from unittest.mock import AsyncMock

import httpx
import pytest

from backend._internal import Session
from backend._internal.atproto.spaces import capability as cap
from backend._internal.atproto.spaces import client as space_client
from backend._internal.atproto.spaces.uris import (
    build_record_uri,
    build_space_uri,
    parse_space_uri,
)
from backend.config import settings

# --- ats:// URI helpers -------------------------------------------------------


def test_space_and_record_uri_roundtrip():
    space = build_space_uri("did:plc:abc", "fm.plyr.privateMedia", "self")
    assert space == "ats://did:plc:abc/fm.plyr.privateMedia/self"

    record = build_record_uri(space, "did:plc:abc", "fm.plyr.track", "rkey1")
    assert record == (
        "ats://did:plc:abc/fm.plyr.privateMedia/self/did:plc:abc/fm.plyr.track/rkey1"
    )

    # parse_space_uri returns the 3-segment space portion from either form
    for uri in (space, record):
        parsed = parse_space_uri(uri)
        assert parsed.owner_did == "did:plc:abc"
        assert parsed.space_type == "fm.plyr.privateMedia"
        assert parsed.skey == "self"


@pytest.mark.parametrize(
    "bad", ["at://did:plc:abc/x/y", "ats://did:plc:abc", "ats://did:plc:abc//self", ""]
)
def test_parse_space_uri_rejects_malformed(bad):
    with pytest.raises(ValueError):
        parse_space_uri(bad)


# --- capability probe interpretation -----------------------------------------


@pytest.mark.parametrize(
    "message,expected",
    [
        # the ONLY supported signal from a failure: ZDS's space-scope check ran
        ("PDS request failed: 403 InsufficientScope", True),
        # not-a-supporting-PDS responses — all unsupported (fail closed)
        ("PDS request failed: 401 AuthMissing", False),  # regression: bsky 401 leak
        ("PDS request failed: 400 InvalidRequest: bad", False),
        ("PDS request failed: 404 UnknownMethod", False),
        ("PDS request failed: 405 MethodNotAllowed", False),
        ("PDS request failed: 501 MethodNotImplemented", False),
        # genuinely transient → don't cache, fail closed for this call
        ("PDS request failed: 503 upstream", None),
        ("PDS request failed: 502 bad gateway", None),
        ("totally opaque error", None),
    ],
)
def test_classify_failure(message, expected):
    assert cap._classify_failure(message) is expected


async def test_detect_capability_insufficient_scope_is_supported(monkeypatch):
    # a capable PDS that hasn't been granted the space scope yet returns 403
    # InsufficientScope from the space route — that proves the route exists.
    async def fake_request(*args, **kwargs):
        raise Exception("PDS request failed: 403 InsufficientScope")

    monkeypatch.setattr(cap, "make_pds_request", fake_request)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://probe-insufficient.test"},
    )
    assert await cap.detect_permissioned_capability(session) is True


async def test_detect_capability_401_is_unsupported(monkeypatch):
    # regression: a non-supporting PDS (e.g. bsky) must NOT be read as supported
    async def fake_request(*args, **kwargs):
        raise Exception("PDS request failed: 401 AuthMissing")

    monkeypatch.setattr(cap, "make_pds_request", fake_request)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://probe-bsky.test"},
    )
    assert await cap.detect_permissioned_capability(session) is False


async def test_detect_capability_supported(monkeypatch):
    async def fake_request(*args, **kwargs):
        return {"spaces": []}

    monkeypatch.setattr(cap, "make_pds_request", fake_request)

    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://probe-supported.test"},
    )
    assert await cap.detect_permissioned_capability(session) is True


async def test_detect_capability_unsupported(monkeypatch):
    async def fake_request(*args, **kwargs):
        raise Exception("PDS request failed: 501 MethodNotImplemented")

    monkeypatch.setattr(cap, "make_pds_request", fake_request)

    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://probe-unsupported.test"},
    )
    assert await cap.detect_permissioned_capability(session) is False


async def test_detect_capability_transient_fails_closed(monkeypatch):
    async def fake_request(*args, **kwargs):
        raise Exception("PDS request failed: 503 upstream")

    monkeypatch.setattr(cap, "make_pds_request", fake_request)

    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://probe-transient.test"},
    )
    assert await cap.detect_permissioned_capability(session) is False


# --- OAuth scope composition --------------------------------------------------


def test_permissioned_scope_opt_in_only():
    # the private-media scope is requested as a permission-set include, not a bare
    # `space:` scope (PDS OAuth grants space access only via a published set).
    base = settings.atproto.resolved_scope_with_extras()
    assert settings.atproto.private_media_include_scope not in base

    with_perm = settings.atproto.resolved_scope_with_extras(permissioned_spaces=True)
    assert settings.atproto.private_media_include_scope in with_perm
    assert (
        settings.atproto.private_media_include_scope == "include:fm.plyr.privateMedia"
    )


# --- space credential caching + renewal ---------------------------------------


async def test_ensure_personal_space_uses_simplespace_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = AsyncMock(return_value={"uri": "unused"})
    monkeypatch.setattr(space_client, "make_pds_request", request)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x"},
    )

    space = await space_client.ensure_personal_space(
        session, space_type="fm.plyr.privateMedia", skey="self"
    )

    assert space == "ats://did:plc:x/fm.plyr.privateMedia/self"
    request.assert_awaited_once_with(
        session,
        "POST",
        "com.atproto.simplespace.createSpace",
        payload={
            "type": "fm.plyr.privateMedia",
            "skey": "self",
            "managingApp": settings.atproto.client_id,
            "policy": "member-list",
            "appAccess": {"type": "open"},
        },
    )


async def test_mint_credential_uses_delegation_token_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pds_request = AsyncMock(return_value={"token": "delegation-token"})
    bearer_request = AsyncMock(
        return_value=httpx.Response(200, json={"credential": "space-credential"})
    )
    monkeypatch.setattr(space_client, "make_pds_request", pds_request)
    monkeypatch.setattr(space_client, "_raw_bearer_request", bearer_request)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://pds.test"},
    )
    space = "ats://did:plc:x/fm.plyr.privateMedia/self"

    credential = await space_client._mint_credential(session, space)

    assert credential == "space-credential"
    pds_request.assert_awaited_once_with(
        session,
        "GET",
        "com.atproto.space.getDelegationToken",
        params={"space": space},
    )
    bearer_request.assert_awaited_once_with(
        "https://pds.test",
        "POST",
        "com.atproto.space.getSpaceCredential",
        "delegation-token",
        json={"space": space},
    )


async def test_mint_credential_maps_zds_access_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        space_client,
        "make_pds_request",
        AsyncMock(return_value={"token": "delegation-token"}),
    )
    monkeypatch.setattr(
        space_client,
        "_raw_bearer_request",
        AsyncMock(
            return_value=httpx.Response(
                403,
                json={"error": "NotPermitted", "message": "requester denied"},
            )
        ),
    )
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://pds.test"},
    )

    with pytest.raises(space_client.SpaceAccessError, match="authority refused"):
        await space_client._mint_credential(
            session, "ats://did:plc:x/fm.plyr.privateMedia/self"
        )


async def test_space_credential_cache_and_force_refresh(monkeypatch):
    space_client._credential_cache.clear()
    calls = {"n": 0}

    async def fake_mint(auth_session, space):
        calls["n"] += 1
        return f"cred-{calls['n']}"

    monkeypatch.setattr(space_client, "_mint_credential", fake_mint)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x"},
    )
    space = "ats://did:plc:x/fm.plyr.privateMedia/self"

    first = await space_client.get_space_credential(session, space)
    cached = await space_client.get_space_credential(session, space)
    assert first == cached == "cred-1"
    assert calls["n"] == 1  # second call served from cache

    renewed = await space_client.get_space_credential(
        session, space, force_refresh=True
    )
    assert renewed == "cred-2"
    assert calls["n"] == 2

"""unit tests for the permissioned-data spaces foundation (#1528).

pure-logic + mocked-PDS-boundary tests for capability detection, ats:// URI
helpers, the OAuth scope composition, and space-credential caching/renewal. the
full data path is exercised against a live ZDS by scripts/permissioned_smoke.py.
"""

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


# --- capability == granted scope ----------------------------------------------


def _session_with_scope(scope: str) -> Session:
    return Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x.test", "scope": scope},
    )


def test_capability_true_when_scope_granted():
    # the granted token carries the expanded `space:<nsid>?...` form
    nsid = settings.atproto.private_media_space_type
    granted = f"atproto blob:*/* space:{nsid}?action=create&did=*&skey=self"
    assert cap.session_has_permissioned_scope(_session_with_scope(granted)) is True
    # the requested `include:<nsid>` form also counts
    assert (
        cap.session_has_permissioned_scope(
            _session_with_scope(f"atproto include:{nsid}")
        )
        is True
    )


def test_capability_false_without_scope():
    base = "atproto blob:*/* include:fm.plyr.stg.authFullApp"
    assert cap.session_has_permissioned_scope(_session_with_scope(base)) is False
    # a session with no scope key must not crash and must read as unsupported
    no_scope = Session(
        session_id="s", did="did:plc:x", handle="x.test", oauth_session={}
    )
    assert cap.session_has_permissioned_scope(no_scope) is False


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

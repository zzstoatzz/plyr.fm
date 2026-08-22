"""unit tests for the permissioned-data spaces foundation (#1528).

pure-logic + mocked-PDS-boundary tests for scope-derived capability, canonical URI
helpers, the OAuth scope composition, and space-credential caching/renewal. the
full data path is exercised against a live ZDS by scripts/permissioned_smoke.py.
"""

from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jose import jwt

from backend._internal import Session
from backend._internal.atproto.spaces import capability as cap
from backend._internal.atproto.spaces import client as space_client
from backend._internal.atproto.spaces.uris import (
    build_record_uri,
    build_space_uri,
    parse_space_record_uri,
    parse_space_uri,
)
from backend._internal.auth import oauth as oauth_module
from backend._internal.auth import space_scope
from backend.config import settings

# --- canonical permissioned at:// URI helpers --------------------------------


def test_space_and_record_uri_roundtrip():
    space = build_space_uri("did:plc:abc", "fm.plyr.privateMedia", "self")
    assert space == "at://did:plc:abc/space/fm.plyr.privateMedia/self"

    record = build_record_uri(space, "did:plc:abc", "fm.plyr.track", "rkey1")
    assert record == (
        "at://did:plc:abc/space/fm.plyr.privateMedia/self/did:plc:abc/fm.plyr.track/rkey1"
    )

    # parse_space_uri returns the space portion from either form
    for uri in (space, record):
        parsed = parse_space_uri(uri)
        assert parsed.owner_did == "did:plc:abc"
        assert parsed.space_type == "fm.plyr.privateMedia"
        assert parsed.skey == "self"

    parsed_record = parse_space_record_uri(record)
    assert parsed_record.space == space
    assert parsed_record.author_did == "did:plc:abc"
    assert parsed_record.collection == "fm.plyr.track"
    assert parsed_record.rkey == "rkey1"


@pytest.mark.parametrize(
    "bad",
    ["at://did:plc:abc/x/y", "ats://did:plc:abc", "at://did:plc:abc/space//self", ""],
)
def test_parse_space_uri_rejects_malformed(bad):
    with pytest.raises(ValueError):
        parse_space_uri(bad)


@pytest.mark.parametrize(
    "bad",
    [
        "at://did:plc:abc/x/y",
        "at://did:plc:abc/space/x/self",
        "at://did:plc:abc/space/x/self/did:plc:abc/y",
        "at://did:plc:abc/space/x/self/did:plc:abc/y/rkey/extra",
    ],
)
def test_parse_space_record_uri_rejects_malformed(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_space_record_uri(bad)


# --- capability from the expanded scope ----------------------------------------


_GRANT = (
    "space:fm.plyr.privateMedia?authority=did:plc:x&skey=self"
    "&collection=fm.plyr.track&action=read&action=create&action=update"
    "&action=delete&manage=create&manage=update&manage=delete"
)


@pytest.fixture
def prod_namespace(monkeypatch):
    monkeypatch.setattr(settings.atproto, "app_namespace", "fm.plyr")


def test_grant_present_requires_manage_and_collection_write(prod_namespace):
    assert space_scope.private_media_grant_present(
        f"atproto blob:*/* {_GRANT}", "did:plc:x"
    )
    # the include: came back unexpanded — a PDS without spaces
    assert not space_scope.private_media_grant_present(
        "atproto blob:*/* include:fm.plyr.privateMediaAccess", "did:plc:x"
    )
    # granted to someone else's authority
    assert not space_scope.private_media_grant_present(_GRANT, "did:plc:other")
    # record writes without manage=create cannot create the space
    no_manage = _GRANT.split("&manage=")[0]
    assert not space_scope.private_media_grant_present(no_manage, "did:plc:x")
    # the pre-alpha `did=*` shape is not a grant
    assert not space_scope.private_media_grant_present(
        "space:fm.plyr.privateMedia?action=create&did=*&skey=self", "did:plc:x"
    )


def test_permissioned_scope_requested_matches_include_or_grant(prod_namespace):
    assert space_scope.permissioned_scope_requested(
        "atproto include:fm.plyr.privateMediaAccess"
    )
    assert space_scope.permissioned_scope_requested(_GRANT)
    assert not space_scope.permissioned_scope_requested("atproto repo:fm.plyr.track")
    assert not space_scope.permissioned_scope_requested("atproto space:fm.other.space")


def test_session_access(prod_namespace):
    session = Session(
        session_id="s", did="did:plc:x", handle="x", oauth_session={"scope": _GRANT}
    )
    assert cap.session_has_private_media_access(session)
    app_pw = Session(
        session_id="s",
        did="did:plc:x",
        handle="x",
        oauth_session={"auth_type": "app_password", "scope": ""},
    )
    assert cap.session_has_private_media_access(app_pw)


@pytest.mark.parametrize(
    ("scopes", "expected"),
    [
        (["atproto", "repo:*", "include:*", "space:*"], True),
        (["atproto", "space"], True),
        (["atproto", "transition:generic", "transition:email"], False),
        (["atproto", "repo:*", "blob:*/*"], False),
        # a scope that merely mentions space is not a space scope
        (["atproto", "rpc:com.atproto.space.listSpaces"], False),
        (None, False),
        ("space:*", False),
    ],
)
def test_advertises_spaces_reads_scopes_supported(scopes, expected):
    metadata = {} if scopes is None else {"scopes_supported": scopes}
    assert cap.advertises_spaces(metadata) is expected


async def test_pds_supports_spaces_without_issuer_is_false():
    session = Session(session_id="s", did="did:plc:x", handle="x", oauth_session={})
    assert await cap.pds_supports_spaces(session) is False


def _login_harness(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, bool]]:
    from backend._internal.atproto import handles

    monkeypatch.setattr(
        handles, "resolve_handle", AsyncMock(return_value={"did": "did:plc:x"})
    )
    monkeypatch.setattr(
        oauth_module, "_check_teal_preference", AsyncMock(return_value=False)
    )
    monkeypatch.setattr(
        oauth_module, "_check_copyright_paradigm", AsyncMock(return_value=False)
    )
    clients: list[dict[str, bool]] = []

    def fake_client(**kwargs):
        clients.append(kwargs)
        return SimpleNamespace(scope=str(kwargs))

    monkeypatch.setattr(oauth_module, "get_oauth_client", fake_client)
    return clients


async def test_login_always_requests_the_private_media_permission_set(
    monkeypatch: pytest.MonkeyPatch,
):
    clients = _login_harness(monkeypatch)
    start = AsyncMock(return_value=("https://auth.example/authorize", "state"))
    monkeypatch.setattr(oauth_module, "_start_authorization_with_retry", start)

    assert await oauth_module.start_oauth_flow("someone.example") == (
        "https://auth.example/authorize",
        "state",
    )
    assert [c["include_permissioned"] for c in clients] == [True]
    start.assert_awaited_once()


async def test_login_retries_without_the_permission_set_when_par_rejects_it(
    monkeypatch: pytest.MonkeyPatch,
):
    clients = _login_harness(monkeypatch)
    start = AsyncMock(
        side_effect=[
            RuntimeError('PAR failed: 400 {"error":"invalid_scope"}'),
            ("https://auth.example/authorize", "state"),
        ]
    )
    monkeypatch.setattr(oauth_module, "_start_authorization_with_retry", start)

    assert await oauth_module.start_oauth_flow("someone.example") == (
        "https://auth.example/authorize",
        "state",
    )
    assert [c.get("include_permissioned", False) for c in clients] == [True, False]


async def test_login_surfaces_other_par_failures(monkeypatch: pytest.MonkeyPatch):
    _login_harness(monkeypatch)
    monkeypatch.setattr(
        oauth_module,
        "_start_authorization_with_retry",
        AsyncMock(side_effect=RuntimeError("PAR failed: 500 boom")),
    )
    with pytest.raises(Exception, match="boom"):
        await oauth_module.start_oauth_flow("someone.example")


# --- OAuth scope composition --------------------------------------------------


def test_permissioned_scope_opt_in_only():
    # the private-media scope is requested as a permission-set include, not a bare
    # `space:` scope (PDS OAuth grants space access only via a published set).
    base = settings.atproto.resolved_scope_with_extras()
    assert settings.atproto.private_media_include_scope not in base

    with_perm = settings.atproto.resolved_scope_with_extras(permissioned_spaces=True)
    assert settings.atproto.private_media_include_scope in with_perm
    assert settings.atproto.private_media_include_scope == (
        "include:fm.plyr.privateMediaAccess"
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

    monkeypatch.setattr(
        space_client.settings.atproto,
        "app_namespace",
        "fm.plyr",
    )

    space = await space_client.ensure_personal_space(session, skey="self")

    assert space == "at://did:plc:x/space/fm.plyr.privateMedia/self"
    request.assert_awaited_once_with(
        session,
        "POST",
        "com.atproto.simplespace.createSpace",
        payload={
            "type": "fm.plyr.privateMedia",
            "skey": "self",
            "policy": {"$type": "com.atproto.simplespace.defs#memberListPolicy"},
            "appAccess": {"$type": "com.atproto.simplespace.defs#open"},
        },
    )
    assert request.await_args is not None
    payload = request.await_args.kwargs["payload"]
    assert "did" not in payload
    assert "config" not in payload


def _owner_session() -> Session:
    return Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x"},
    )


async def test_add_and_remove_member_use_simplespace_shapes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = AsyncMock(return_value={})
    monkeypatch.setattr(space_client, "make_pds_request", request)
    session = _owner_session()
    space = "at://did:plc:x/space/fm.plyr.privateMedia/self"

    await space_client.add_space_member(session, space=space, did="did:plc:friend")
    request.assert_awaited_with(
        session,
        "POST",
        "com.atproto.simplespace.addMember",
        payload={"space": space, "did": "did:plc:friend"},
    )

    space_client._credential_cache[("did:plc:friend", space)] = (
        space_client.SpaceCredential(
            token="t", dpop_key=ec.generate_private_key(ec.SECP256R1()), expires_at=1e12
        )
    )
    await space_client.remove_space_member(session, space=space, did="did:plc:friend")
    request.assert_awaited_with(
        session,
        "POST",
        "com.atproto.simplespace.removeMember",
        payload={"space": space, "did": "did:plc:friend"},
    )
    # plyr forgets the credential it minted for the removed member
    assert ("did:plc:friend", space) not in space_client._credential_cache


async def test_list_members_pages_by_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    request = AsyncMock(
        side_effect=[
            {"members": [{"did": "did:plc:a"}, {"did": "did:plc:b"}], "cursor": "c1"},
            {"members": [{"did": "did:plc:c"}]},
        ]
    )
    monkeypatch.setattr(space_client, "make_pds_request", request)
    session = _owner_session()
    space = "at://did:plc:x/space/fm.plyr.privateMedia/self"

    first, cursor = await space_client.list_space_members(session, space=space)
    assert (first, cursor) == (["did:plc:a", "did:plc:b"], "c1")
    second, end = await space_client.list_space_members(
        session, space=space, cursor="c1"
    )
    assert (second, end) == (["did:plc:c"], None)
    assert request.await_args_list[0].kwargs["params"] == {"space": space, "limit": 100}
    assert request.await_args_list[1].kwargs["params"] == {
        "space": space,
        "limit": 100,
        "cursor": "c1",
    }


async def test_mint_credential_uses_delegation_token_flow(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pds_request = AsyncMock(return_value={"token": "delegation-token"})
    token_request = AsyncMock(
        return_value=httpx.Response(200, json={"credential": "space-credential"})
    )
    monkeypatch.setattr(space_client, "make_pds_request", pds_request)
    monkeypatch.setattr(space_client, "_space_token_request", token_request)
    monkeypatch.setattr(
        space_client,
        "_space_host_url",
        AsyncMock(return_value="https://space-host.test"),
    )
    monkeypatch.setattr(
        space_client, "create_space_client_attestation", lambda _audience: None
    )
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://pds.test"},
    )
    space = "at://did:plc:x/space/fm.plyr.privateMedia/self"

    credential = await space_client._mint_credential(session, space)

    assert credential.token == "space-credential"
    pds_request.assert_awaited_once_with(
        session,
        "GET",
        "com.atproto.space.getDelegationToken",
        params={"space": space},
    )
    token_request.assert_awaited_once_with(
        "https://space-host.test",
        "POST",
        "com.atproto.space.getSpaceCredential",
        "delegation-token",
        ANY,
        issuance=True,
        json={"space": space},
    )


async def test_mint_credential_sends_separate_client_attestation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token_request = AsyncMock(
        return_value=httpx.Response(200, json={"credential": "space-credential"})
    )
    monkeypatch.setattr(
        space_client,
        "make_pds_request",
        AsyncMock(return_value={"token": "delegation-token"}),
    )
    monkeypatch.setattr(space_client, "_space_token_request", token_request)
    monkeypatch.setattr(
        space_client,
        "_space_host_url",
        AsyncMock(return_value="https://space-host.test"),
    )
    monkeypatch.setattr(
        space_client,
        "create_space_client_attestation",
        lambda audience: f"attestation-for:{audience}",
    )
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://pds.test"},
    )
    space = "at://did:plc:authority/space/fm.plyr.privateMedia/self"

    await space_client._mint_credential(session, space)

    token_request.assert_awaited_once_with(
        "https://space-host.test",
        "POST",
        "com.atproto.space.getSpaceCredential",
        "delegation-token",
        ANY,
        issuance=True,
        json={
            "space": space,
            "clientAttestation": (
                "attestation-for:did:plc:authority#atproto_space_host"
            ),
        },
    )


def test_space_client_attestation_uses_proposal_jwt_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(
        oauth_module,
        "_load_client_secret",
        lambda: (private_key, "space-test-key"),
    )
    monkeypatch.setattr(
        oauth_module.settings.atproto,
        "client_id",
        "https://api.plyr.fm/oauth-client-metadata.json",
    )

    token = oauth_module.create_space_client_attestation(
        "did:plc:authority#atproto_space_host"
    )

    assert token is not None
    header = jwt.get_unverified_header(token)
    claims = jwt.get_unverified_claims(token)
    assert header == {
        "alg": "ES256",
        "kid": "space-test-key",
        "typ": "atproto-client-attestation+jwt",
    }
    assert claims["iss"] == "https://api.plyr.fm/oauth-client-metadata.json"
    assert claims["sub"] == claims["iss"]
    assert claims["aud"] == "did:plc:authority#atproto_space_host"
    assert claims["exp"] - claims["iat"] == 60
    assert claims["jti"]


async def test_space_host_resolution_prefers_dedicated_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    did = "did:plc:authority"
    document = SimpleNamespace(
        service=[
            SimpleNamespace(
                id=f"{did}#atproto_space_host",
                service_endpoint="https://spaces.example",
            )
        ],
        get_pds_endpoint=lambda: "https://pds.example",
    )
    resolver = SimpleNamespace(resolve=AsyncMock(return_value=document))
    monkeypatch.setattr(space_client, "AsyncDidResolver", lambda: resolver)

    endpoint = await space_client._space_host_url(
        f"at://{did}/space/fm.plyr.privateMedia/self"
    )

    assert endpoint == "https://spaces.example"


async def test_space_host_resolution_falls_back_to_pds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = SimpleNamespace(
        service=[],
        get_pds_endpoint=lambda: "https://pds.example/",
    )
    resolver = SimpleNamespace(resolve=AsyncMock(return_value=document))
    monkeypatch.setattr(space_client, "AsyncDidResolver", lambda: resolver)

    endpoint = await space_client._space_host_url(
        "at://did:plc:authority/space/fm.plyr.privateMedia/self"
    )

    assert endpoint == "https://pds.example"


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
        "_space_token_request",
        AsyncMock(
            return_value=httpx.Response(
                403,
                json={"error": "NotPermitted", "message": "requester denied"},
            )
        ),
    )
    monkeypatch.setattr(
        space_client,
        "_space_host_url",
        AsyncMock(return_value="https://space-host.test"),
    )
    monkeypatch.setattr(
        space_client, "create_space_client_attestation", lambda _audience: None
    )
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://pds.test"},
    )

    with pytest.raises(space_client.SpaceAccessError, match="authority refused"):
        await space_client._mint_credential(
            session, "at://did:plc:x/space/fm.plyr.privateMedia/self"
        )


async def test_delete_space_record_uses_record_uri_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = AsyncMock(return_value={})
    monkeypatch.setattr(space_client, "make_pds_request", request)
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x"},
    )

    await space_client.delete_space_record(
        session,
        "at://did:plc:x/space/fm.plyr.privateMedia/self/did:plc:x/fm.plyr.track/rk",
    )

    request.assert_awaited_once_with(
        session,
        "POST",
        "com.atproto.space.deleteRecord",
        payload={
            "space": "at://did:plc:x/space/fm.plyr.privateMedia/self",
            "repo": "did:plc:x",
            "collection": "fm.plyr.track",
            "rkey": "rk",
        },
        success_codes=(200, 201, 204),
    )


# --- discovery and sync routing ----------------------------------------------


async def test_list_spaces_routes_through_authenticated_pds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = AsyncMock(return_value={"spaces": []})
    monkeypatch.setattr(space_client, "make_pds_request", request)
    session = Session(
        session_id="s",
        did="did:plc:user",
        handle="user.test",
        oauth_session={},
    )

    result = await space_client.list_spaces(
        session,
        space_type="fm.example.catalog",
        limit=25,
    )

    assert result == {"spaces": []}
    request.assert_awaited_once_with(
        session,
        "GET",
        "com.atproto.space.listSpaces",
        params={
            "did": "did:plc:user",
            "limit": 25,
            "type": "fm.example.catalog",
        },
    )


async def test_list_space_repos_routes_to_authority_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read = AsyncMock(return_value={"repos": []})
    host = AsyncMock(return_value="https://authority-space.example")
    monkeypatch.setattr(space_client, "_credential_read", read)
    monkeypatch.setattr(space_client, "_space_host_url", host)
    session = Session(
        session_id="s",
        did="did:plc:user",
        handle="user.test",
        oauth_session={},
    )
    space = "at://did:plc:authority/space/fm.example.catalog/main"

    result = await space_client.list_space_repos(session, space, limit=20)

    assert result == {"repos": []}
    host.assert_awaited_once_with(space)
    read.assert_awaited_once_with(
        session,
        host_url="https://authority-space.example",
        endpoint="com.atproto.space.listRepos",
        space=space,
        params={"space": space, "limit": 20},
    )


async def test_list_space_repos_forwards_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read = AsyncMock(return_value={"repos": []})
    monkeypatch.setattr(space_client, "_credential_read", read)
    monkeypatch.setattr(
        space_client, "_space_host_url", AsyncMock(return_value="https://a.example")
    )
    session = Session(session_id="s", did="did:plc:user", handle="u", oauth_session={})
    space = "at://did:plc:authority/space/fm.example.catalog/main"

    await space_client.list_space_repos(session, space, limit=20, cursor="page-2")

    assert read.await_args is not None
    assert read.await_args.kwargs["params"] == {
        "space": space,
        "limit": 20,
        "cursor": "page-2",
    }


async def test_list_space_records_routes_to_writer_repo_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read = AsyncMock(return_value={"records": []})
    host = AsyncMock(return_value="https://writer-pds.example")
    monkeypatch.setattr(space_client, "_credential_read", read)
    monkeypatch.setattr(space_client, "_repo_host_url", host)
    session = Session(
        session_id="s",
        did="did:plc:user",
        handle="user.test",
        oauth_session={},
    )
    space = "at://did:plc:authority/space/fm.example.catalog/main"

    result = await space_client.list_space_records(
        session,
        space=space,
        repo="did:plc:writer",
        collection="fm.example.track",
        limit=75,
        exclude_values=True,
    )

    assert result == {"records": []}
    host.assert_awaited_once_with("did:plc:writer")
    read.assert_awaited_once_with(
        session,
        host_url="https://writer-pds.example",
        endpoint="com.atproto.space.listRecords",
        space=space,
        params={
            "space": space,
            "repo": "did:plc:writer",
            "limit": 75,
            "excludeValues": True,
            "collection": "fm.example.track",
        },
    )


async def test_list_space_repo_ops_routes_to_writer_repo_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    read = AsyncMock(return_value={"ops": []})
    host = AsyncMock(return_value="https://writer-pds.example")
    monkeypatch.setattr(space_client, "_credential_read", read)
    monkeypatch.setattr(space_client, "_repo_host_url", host)
    session = Session(
        session_id="s",
        did="did:plc:user",
        handle="user.test",
        oauth_session={},
    )
    space = "at://did:plc:authority/space/fm.example.catalog/main"

    result = await space_client.list_space_repo_ops(
        session,
        space=space,
        repo="did:plc:writer",
        since="3mabc",
        limit=250,
    )

    assert result == {"ops": []}
    host.assert_awaited_once_with("did:plc:writer")
    read.assert_awaited_once_with(
        session,
        host_url="https://writer-pds.example",
        endpoint="com.atproto.space.listRepoOps",
        space=space,
        params={
            "space": space,
            "repo": "did:plc:writer",
            "since": "3mabc",
            "limit": 250,
        },
    )


async def test_list_space_repo_ops_pages_by_cursor_and_tolerates_missing_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    full_page = {"ops": [{"rev": "3mabd"}], "cursor": "page-2"}
    head_page = {"ops": [], "commit": {"rev": "3mabd"}}
    read = AsyncMock(side_effect=[full_page, head_page])
    monkeypatch.setattr(space_client, "_credential_read", read)
    monkeypatch.setattr(
        space_client, "_repo_host_url", AsyncMock(return_value="https://w.example")
    )
    session = Session(session_id="s", did="did:plc:user", handle="u", oauth_session={})
    space = "at://did:plc:authority/space/fm.example.catalog/main"

    first = await space_client.list_space_repo_ops(
        session, space=space, repo="did:plc:writer", since="3mabc"
    )
    assert first == full_page
    assert "commit" not in first

    second = await space_client.list_space_repo_ops(
        session, space=space, repo="did:plc:writer", cursor=first["cursor"]
    )
    assert second == head_page
    assert "cursor" not in second
    assert read.await_args is not None
    assert read.await_args.kwargs["params"] == {
        "space": space,
        "repo": "did:plc:writer",
        "limit": 500,
        "cursor": "page-2",
    }

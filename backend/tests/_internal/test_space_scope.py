"""``space:`` scope parsing and matching, against the oauth-scopes test vectors."""

import pytest

from backend._internal.auth.space_scope import (
    SPACE_DEFAULT_ACTIONS,
    SpaceAction,
    SpaceManageOp,
    SpacePermission,
    allows_space,
    space_grants,
)

TYPE = "com.atmoboards.forum"
AUTHORITY = "did:plc:abc"
SKEY = "default"


def covers(
    scope: SpacePermission,
    *,
    type: str = TYPE,
    authority: str = AUTHORITY,
    skey: str = SKEY,
    action: SpaceAction | None = None,
    collection: str | None = None,
    manage: SpaceManageOp | None = None,
) -> bool:
    return scope.matches(
        type=type,
        authority=authority,
        skey=skey,
        action=action,
        collection=collection,
        manage=manage,
    )


def parse(scope: str) -> SpacePermission:
    parsed = SpacePermission.from_string(scope)
    assert parsed is not None, scope
    return parsed


def any_authority(rest: str = "") -> SpacePermission:
    return parse(f"space:com.atmoboards.forum?authority=*{rest}")


def test_positional_type_with_all_defaults() -> None:
    scope = parse("space:com.atmoboards.forum")
    assert scope.type == "com.atmoboards.forum"
    assert scope.authority == "self"
    assert scope.skey == "*"
    assert scope.collection == ()
    assert scope.action == SPACE_DEFAULT_ACTIONS
    assert scope.manage == ()


def test_fully_specified_scope() -> None:
    scope = parse(
        "space:com.atmoboards.forum?authority=did:plc:abc123xyz&skey=default"
        "&collection=com.atmoboards.thread&action=create&action=update"
    )
    assert scope.authority == "did:plc:abc123xyz"
    assert scope.skey == "default"
    assert scope.collection == ("com.atmoboards.thread",)
    assert scope.action == ("create", "update")


def test_wildcards_and_manage_verbs() -> None:
    assert parse("space:*?authority=did:plc:abc123xyz").type == "*"
    assert parse("space:com.atmoboards.forum?authority=*").authority == "*"
    assert parse("space:com.atmoboards.forum?manage=update&manage=delete").manage == (
        "update",
        "delete",
    )
    assert parse("space:com.atmoboards.forum?action=read_self&collection=*").action == (
        "read_self",
    )


@pytest.mark.parametrize(
    "scope",
    [
        "space:foo bar",
        "space:short",
        "space:*?authority=not-a-did",
        "space:*?authority=did:",
        "space:com.example.x?action=bogus",
        "space:com.example.x?manage=bogus",
        "space:com.example.x?collection=not_an_nsid",
        "space:com.example.x?skey=",
        "space:com.example.x?skey=hello%20world",
        "space:com.example.x?skey=.",
        "space:com.example.x?skey=..",
        "space:com.example.x?skey=a%2Fb",
        "space:com.example.x?skey=" + "x" * 513,
        "repo:com.example.x",
        "whatever",
    ],
)
def test_rejects_invalid_scopes(scope: str) -> None:
    assert SpacePermission.from_string(scope) is None


@pytest.mark.parametrize("skey", ["self", "3jui7kd54zh2y", "a.b-c_d~e:f", "x" * 512])
def test_accepts_rkey_shaped_skeys(skey: str) -> None:
    assert parse(f"space:com.example.x?skey={skey}").skey == skey


def test_read_and_write_matching() -> None:
    assert covers(any_authority(), action="read")
    assert not covers(any_authority("&action=create"), action="read")
    assert not covers(
        any_authority("&action=read"),
        action="create",
        collection="com.atmoboards.thread",
    )
    assert not covers(
        any_authority(), action="create", collection="com.atmoboards.thread"
    )
    assert covers(
        any_authority("&collection=*"), action="update", collection="another.one.here"
    )
    limited = any_authority("&collection=com.atmoboards.thread&action=create")
    assert covers(limited, action="create", collection="com.atmoboards.thread")
    assert not covers(limited, action="create", collection="com.atmoboards.reply")


def test_manage_is_independent_of_collection() -> None:
    scope = any_authority("&action=read&manage=update")
    assert covers(scope, manage="update")
    assert not covers(scope, manage="delete")
    assert not covers(any_authority("&action=read"), manage="update")
    assert not covers(any_authority(), manage="update")


def test_read_self_semantics() -> None:
    assert covers(any_authority("&action=read"), action="read_self")
    read_self = any_authority("&action=read_self")
    assert covers(read_self, action="read_self")
    assert not covers(read_self, action="read")
    assert covers(
        any_authority("&action=read_self&collection=com.atmoboards.thread"),
        action="read_self",
    )


def test_tuple_matching_and_self_authority() -> None:
    assert covers(
        parse("space:*?authority=did:plc:abc"),
        type="com.example.different",
        action="read",
    )
    concrete = parse("space:com.atmoboards.forum?authority=did:plc:abc&skey=default")
    assert covers(concrete, action="read")
    assert not covers(concrete, authority="did:plc:other", action="read")
    assert not covers(concrete, skey="other", action="read")

    unresolved = parse("space:com.atmoboards.forum")
    assert unresolved.is_self_authority
    assert not covers(unresolved, action="read")
    resolved = unresolved.with_resolved_authority("did:plc:abc")
    assert covers(resolved, action="read")
    assert not covers(resolved, authority="did:plc:other", action="read")


@pytest.mark.parametrize(
    "scope",
    [
        "space:com.atmoboards.forum",
        "space:com.atmoboards.forum?authority=did:plc:abc123xyz&skey=default"
        "&collection=com.atmoboards.thread&action=create",
    ],
)
def test_round_trips(scope: str) -> None:
    assert str(parse(scope)) == scope


def test_allows_space_over_a_granted_scope_string() -> None:
    granted = (
        "atproto blob:*/* repo:fm.plyr.track "
        "space:fm.plyr.privateMedia?authority=did:plc:abc&skey=self"
        "&collection=fm.plyr.track&action=read&action=create&action=update"
        "&action=delete&manage=create&manage=update&manage=delete"
    )
    assert len(space_grants(granted)) == 1
    assert allows_space(
        granted,
        type="fm.plyr.privateMedia",
        authority="did:plc:abc",
        skey="self",
        manage="create",
    )
    assert allows_space(
        granted,
        type="fm.plyr.privateMedia",
        authority="did:plc:abc",
        skey="self",
        action="create",
        collection="fm.plyr.track",
    )
    assert not allows_space(
        granted,
        type="fm.plyr.privateMedia",
        authority="did:plc:abc",
        skey="self",
        action="create",
        collection="fm.plyr.like",
    )
    assert not allows_space(
        granted,
        type="fm.plyr.privateMedia",
        authority="did:plc:other",
        skey="self",
        action="read",
    )
    assert not allows_space(
        "atproto include:fm.plyr.privateMediaAccess",
        type="fm.plyr.privateMedia",
        authority="did:plc:abc",
        skey="self",
        action="read",
    )

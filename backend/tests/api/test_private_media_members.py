"""the artist's private-media member list lives on the PDS; plyr keeps no copy."""

from unittest.mock import ANY, AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto.profiles import ResolvedProfile
from backend._internal.atproto.spaces.client import MEMBERS_PAGE_LIMIT
from backend.main import app
from backend.models import Artist

_ARTIST = "did:test:pmm-artist"
_SPACE = f"at://{_ARTIST}/space/fm.plyr.privateMedia/self"


def _owner() -> Session:
    s = Session.__new__(Session)
    s.did = _ARTIST
    s.handle = "pmm.test"
    s.session_id = "sess"
    s.oauth_session = {"did": _ARTIST, "pds_url": "https://test.pds"}
    return s


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    a = Artist(did=_ARTIST, handle="pmm.test", display_name="PMM")
    db_session.add(a)
    await db_session.commit()
    return a


@pytest.fixture
def as_owner():
    async def _auth() -> Session:
        return _owner()

    app.dependency_overrides[require_auth] = _auth
    yield
    app.dependency_overrides.clear()


def _profiles(dids):
    return [
        ResolvedProfile(
            did=d, handle=f"{d[-4:]}.test", display_name=d[-4:], avatar_url=None
        )
        for d in dids
    ]


def _space():
    return patch(
        "backend.api.artists.ensure_personal_space", AsyncMock(return_value=_SPACE)
    )


def _resolves():
    return patch(
        "backend.api.artists.resolve_dids",
        AsyncMock(side_effect=lambda d: _profiles(d)),
    )


async def test_add_writes_pds_and_forgets_what_plyr_held(artist: Artist, as_owner):
    with (
        _space(),
        patch("backend.api.artists.add_space_member", AsyncMock()) as add,
        patch("backend.api.artists.forget_access", AsyncMock()) as forget,
        patch(
            "backend.api.artists.resolve_handle",
            AsyncMock(return_value={"did": "did:test:friend"}),
        ),
        _resolves(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.post(
                "/artists/me/private-media/members", json={"actor": "@friend.test"}
            )
    assert r.status_code == 201, r.text
    assert r.json()["did"] == "did:test:friend"
    add.assert_awaited_once_with(ANY, space=_SPACE, did="did:test:friend")
    forget.assert_awaited_once_with("did:test:friend", _ARTIST)


async def test_add_rejects_self_and_unknown(artist: Artist, as_owner):
    with (
        _space(),
        patch("backend.api.artists.add_space_member", AsyncMock()) as add,
        patch("backend.api.artists.resolve_handle", AsyncMock(return_value=None)),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            me = await c.post(
                "/artists/me/private-media/members", json={"actor": _ARTIST}
            )
            nobody = await c.post(
                "/artists/me/private-media/members", json={"actor": "nobody.test"}
            )
    assert me.status_code == 400
    assert nobody.status_code == 404
    add.assert_not_awaited()


async def test_remove_writes_pds_and_forgets_what_plyr_held(artist: Artist, as_owner):
    with (
        _space(),
        patch("backend.api.artists.remove_space_member", AsyncMock()) as remove,
        patch("backend.api.artists.forget_access", AsyncMock()) as forget,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.delete("/artists/me/private-media/members/did:test:friend")
    assert r.status_code == 204
    remove.assert_awaited_once_with(ANY, space=_SPACE, did="did:test:friend")
    forget.assert_awaited_once_with("did:test:friend", _ARTIST)


async def test_list_reads_the_pds_every_time(artist: Artist, as_owner):
    full_page = [f"did:test:m{i}" for i in range(MEMBERS_PAGE_LIMIT - 1)] + [_ARTIST]
    pages = [(full_page, "c1"), (["did:test:b"], None)]
    with (
        _space(),
        patch(
            "backend.api.artists.list_space_members", AsyncMock(side_effect=pages)
        ) as listed,
        _resolves(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.get("/artists/me/private-media/members")
    assert r.status_code == 200
    assert [m["did"] for m in r.json()] == [*full_page[:-1], "did:test:b"]
    assert listed.await_count == 2


async def test_list_fails_honestly_when_pds_cannot_answer(artist: Artist, as_owner):
    with (
        _space(),
        patch(
            "backend.api.artists.list_space_members",
            AsyncMock(side_effect=RuntimeError("down")),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.get("/artists/me/private-media/members")
    assert r.status_code == 502


async def test_members_require_auth():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        assert (await c.get("/artists/me/private-media/members")).status_code == 401


async def test_remove_rejects_self(artist: Artist, as_owner):
    with patch("backend.api.artists.remove_space_member", AsyncMock()) as remove:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.delete(f"/artists/me/private-media/members/{_ARTIST}")
    assert r.status_code == 400
    remove.assert_not_awaited()

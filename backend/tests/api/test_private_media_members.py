"""the artist's private-media member list: PDS is the source of truth, plyr mirrors."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto.profiles import ResolvedProfile
from backend.main import app
from backend.models import Artist, PrivateMediaMember

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


async def _mirror(db: AsyncSession) -> list[str]:
    rows = await db.execute(
        select(PrivateMediaMember.member_did).where(
            PrivateMediaMember.artist_did == _ARTIST
        )
    )
    return sorted(rows.scalars().all())


async def test_add_writes_pds_then_mirror(
    db_session: AsyncSession, artist: Artist, as_owner
):
    with (
        patch(
            "backend.api.artists.ensure_personal_space", AsyncMock(return_value=_SPACE)
        ),
        patch("backend.api.artists.add_space_member", AsyncMock()) as add,
        patch(
            "backend.api.artists.resolve_handle",
            AsyncMock(return_value={"did": "did:test:friend"}),
        ),
        patch(
            "backend.api.artists.resolve_dids",
            AsyncMock(side_effect=lambda d: _profiles(d)),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.post(
                "/artists/me/private-media/members", json={"actor": "@friend.test"}
            )
    assert r.status_code == 201, r.text
    assert r.json()["did"] == "did:test:friend"
    add.assert_awaited_once_with(_owner_like(add), space=_SPACE, did="did:test:friend")
    assert await _mirror(db_session) == ["did:test:friend"]


def _owner_like(mock):
    return mock.await_args.args[0]


async def test_add_rejects_self_and_unknown(
    db_session: AsyncSession, artist: Artist, as_owner
):
    with (
        patch(
            "backend.api.artists.ensure_personal_space", AsyncMock(return_value=_SPACE)
        ),
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
    assert await _mirror(db_session) == []


async def test_remove_clears_pds_and_mirror(
    db_session: AsyncSession, artist: Artist, as_owner
):
    db_session.add(PrivateMediaMember(artist_did=_ARTIST, member_did="did:test:friend"))
    await db_session.commit()
    with (
        patch(
            "backend.api.artists.ensure_personal_space", AsyncMock(return_value=_SPACE)
        ),
        patch("backend.api.artists.remove_space_member", AsyncMock()) as remove,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.delete("/artists/me/private-media/members/did:test:friend")
    assert r.status_code == 204
    remove.assert_awaited_once()
    assert remove.await_args.kwargs == {"space": _SPACE, "did": "did:test:friend"}
    assert await _mirror(db_session) == []


async def test_list_reconciles_mirror_from_pds(
    db_session: AsyncSession, artist: Artist, as_owner
):
    # plyr thinks `stale` is a member; the PDS says `a` and `b` (and the authority itself)
    db_session.add(PrivateMediaMember(artist_did=_ARTIST, member_did="did:test:stale"))
    await db_session.commit()
    pages = [(["did:test:a", _ARTIST], "c1"), (["did:test:b"], None)]
    with (
        patch(
            "backend.api.artists.ensure_personal_space", AsyncMock(return_value=_SPACE)
        ),
        patch("backend.api.artists.list_space_members", AsyncMock(side_effect=pages)),
        patch(
            "backend.api.artists.resolve_dids",
            AsyncMock(side_effect=lambda d: _profiles(d)),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.get("/artists/me/private-media/members")
    assert r.status_code == 200
    assert [m["did"] for m in r.json()] == ["did:test:a", "did:test:b"]
    assert await _mirror(db_session) == ["did:test:a", "did:test:b"]


async def test_list_falls_back_to_mirror_when_pds_cannot_answer(
    db_session: AsyncSession, artist: Artist, as_owner
):
    db_session.add(PrivateMediaMember(artist_did=_ARTIST, member_did="did:test:kept"))
    await db_session.commit()
    with (
        patch(
            "backend.api.artists.ensure_personal_space", AsyncMock(return_value=_SPACE)
        ),
        patch(
            "backend.api.artists.list_space_members",
            AsyncMock(side_effect=RuntimeError("down")),
        ),
        patch(
            "backend.api.artists.resolve_dids",
            AsyncMock(side_effect=lambda d: _profiles(d)),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.get("/artists/me/private-media/members")
    assert r.status_code == 200
    assert [m["did"] for m in r.json()] == ["did:test:kept"]
    assert await _mirror(db_session) == ["did:test:kept"]


async def test_members_require_auth():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        assert (await c.get("/artists/me/private-media/members")).status_code == 401


async def test_remove_rejects_self(db_session: AsyncSession, artist: Artist, as_owner):
    with patch("backend.api.artists.remove_space_member", AsyncMock()) as remove:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            r = await c.delete(f"/artists/me/private-media/members/{_ARTIST}")
    assert r.status_code == 400
    remove.assert_not_awaited()

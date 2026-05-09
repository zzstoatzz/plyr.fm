"""end-to-end tests for private playlist creation and access."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session, require_auth
from backend._internal.spaces import (
    PERSONAL_SPACE_TYPE,
    PLAYLIST_COLLECTION,
    build_space_uri,
)
from backend.main import app
from backend.models import Artist, Playlist, Space, SpaceMember, SpaceRecord


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:plc:owner"):
        self.did = did
        self.handle = "owner.test"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "owner.test",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
async def owner(db_session: AsyncSession) -> Artist:
    artist = Artist(did="did:plc:owner", handle="owner.test", display_name="Owner")
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def viewer(db_session: AsyncSession) -> Artist:
    artist = Artist(did="did:plc:viewer", handle="viewer.test", display_name="Viewer")
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
def app_as_owner() -> Generator[FastAPI, None, None]:
    async def _auth() -> Session:
        return MockSession(did="did:plc:owner")

    app.dependency_overrides[require_auth] = _auth
    app.dependency_overrides[get_optional_session] = _auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def app_as_viewer() -> Generator[FastAPI, None, None]:
    async def _auth() -> Session:
        return MockSession(did="did:plc:viewer")

    app.dependency_overrides[require_auth] = _auth
    app.dependency_overrides[get_optional_session] = _auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def app_anon() -> Generator[FastAPI, None, None]:
    async def _none() -> None:
        return None

    app.dependency_overrides[get_optional_session] = _none
    yield app
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------


async def test_create_private_playlist_creates_space_member_and_record(
    app_as_owner: FastAPI,
    db_session: AsyncSession,
    owner: Artist,
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/lists/playlists",
            json={"name": "secret stash", "is_private": True},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["is_private"] is True
    assert body["atproto_record_uri"] is None
    assert body["name"] == "secret stash"

    expected_uri = build_space_uri(owner.did, PERSONAL_SPACE_TYPE, "playlists")

    space = (
        await db_session.execute(select(Space).where(Space.uri == expected_uri))
    ).scalar_one()
    assert space.owner_did == owner.did

    members = (
        (
            await db_session.execute(
                select(SpaceMember.did).where(SpaceMember.space_uri == expected_uri)
            )
        )
        .scalars()
        .all()
    )
    assert list(members) == [owner.did]

    record = (
        await db_session.execute(
            select(SpaceRecord).where(
                SpaceRecord.space_uri == expected_uri,
                SpaceRecord.collection == PLAYLIST_COLLECTION,
                SpaceRecord.rkey == body["id"],
            )
        )
    ).scalar_one()
    assert record.value["name"] == "secret stash"
    assert record.value["items"] == []

    playlist = (
        await db_session.execute(select(Playlist).where(Playlist.id == body["id"]))
    ).scalar_one()
    assert playlist.space_uri == expected_uri
    assert playlist.atproto_record_uri is None


async def test_creating_two_private_playlists_reuses_space(
    app_as_owner: FastAPI,
    db_session: AsyncSession,
    owner: Artist,
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        for name in ("first", "second"):
            resp = await client.post(
                "/lists/playlists",
                json={"name": name, "is_private": True},
            )
            assert resp.status_code == 200

    spaces = (
        (await db_session.execute(select(Space).where(Space.owner_did == owner.did)))
        .scalars()
        .all()
    )
    assert len(spaces) == 1


# ---------------------------------------------------------------------------
# read access
# ---------------------------------------------------------------------------


async def _create_private_playlist(client: AsyncClient, name: str = "p") -> dict:
    resp = await client.post(
        "/lists/playlists",
        json={"name": name, "is_private": True},
    )
    assert resp.status_code == 200
    return resp.json()


async def test_owner_can_read_own_private_playlist(
    app_as_owner: FastAPI, owner: Artist
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        playlist = await _create_private_playlist(client, "mine")
        resp = await client.get(f"/lists/playlists/{playlist['id']}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["is_private"] is True
    assert body["tracks"] == []


async def test_other_user_cannot_read_private_playlist(
    db_session: AsyncSession, owner: Artist, viewer: Artist
) -> None:
    # owner creates the private playlist
    async def auth_owner() -> Session:
        return MockSession(did="did:plc:owner")

    app.dependency_overrides[require_auth] = auth_owner
    app.dependency_overrides[get_optional_session] = auth_owner
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            playlist = await _create_private_playlist(client, "secret")
    finally:
        app.dependency_overrides.clear()

    # viewer attempts to read
    async def auth_viewer() -> Session:
        return MockSession(did="did:plc:viewer")

    app.dependency_overrides[get_optional_session] = auth_viewer
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(f"/lists/playlists/{playlist['id']}")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"]


async def test_anonymous_cannot_read_private_playlist(
    owner: Artist,
) -> None:
    async def auth_owner() -> Session:
        return MockSession(did="did:plc:owner")

    app.dependency_overrides[require_auth] = auth_owner
    app.dependency_overrides[get_optional_session] = auth_owner
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            playlist = await _create_private_playlist(client, "secret")
    finally:
        app.dependency_overrides.clear()

    async def no_session() -> None:
        return None

    app.dependency_overrides[get_optional_session] = no_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(f"/lists/playlists/{playlist['id']}")
            meta = await client.get(f"/lists/playlists/{playlist['id']}/meta")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 404
    assert meta.status_code == 404


# ---------------------------------------------------------------------------
# list filters
# ---------------------------------------------------------------------------


async def test_list_owned_playlists_includes_private(
    app_as_owner: FastAPI, owner: Artist
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        await _create_private_playlist(client, "mine")
        resp = await client.get("/lists/playlists")

    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["is_private"] is True


async def test_artist_public_playlists_excludes_private(
    app_as_owner: FastAPI, owner: Artist
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        await _create_private_playlist(client, "secret")
        resp = await client.get(f"/lists/playlists/by-artist/{owner.did}")

    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


async def test_delete_private_playlist_removes_space_record(
    app_as_owner: FastAPI, db_session: AsyncSession, owner: Artist
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        playlist = await _create_private_playlist(client, "doomed")
        resp = await client.delete(f"/lists/playlists/{playlist['id']}")

    assert resp.status_code == 200

    remaining_record = (
        await db_session.execute(
            select(SpaceRecord).where(SpaceRecord.rkey == playlist["id"])
        )
    ).scalar_one_or_none()
    assert remaining_record is None

    remaining_playlist = (
        await db_session.execute(select(Playlist).where(Playlist.id == playlist["id"]))
    ).scalar_one_or_none()
    assert remaining_playlist is None

    # space + member retained for reuse
    space = (
        await db_session.execute(select(Space).where(Space.owner_did == owner.did))
    ).scalar_one()
    assert space is not None

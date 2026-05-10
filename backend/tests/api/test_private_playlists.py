"""end-to-end tests for private playlists.

private playlists are app-layer privacy: stored in postgres, never pushed
to the user's PDS. these tests cover both the happy path and the
existence-leak hardening — non-owners must not be able to tell a private
playlist exists. see #1384.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session, require_auth
from backend.main import app
from backend.models import Artist, Playlist


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


async def _create_private_playlist(client: AsyncClient, name: str = "p") -> dict:
    resp = await client.post(
        "/lists/playlists",
        json={"name": name, "is_private": True},
    )
    assert resp.status_code == 200
    return resp.json()


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------


async def test_create_private_playlist_skips_pds(
    app_as_owner: FastAPI, db_session: AsyncSession, owner: Artist
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

    playlist = (
        await db_session.execute(select(Playlist).where(Playlist.id == body["id"]))
    ).scalar_one()
    assert playlist.is_private is True
    assert playlist.atproto_record_uri is None
    assert playlist.atproto_record_cid is None
    assert playlist.items_json == []


# ---------------------------------------------------------------------------
# read access
# ---------------------------------------------------------------------------


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


async def test_anonymous_cannot_read_private_playlist(owner: Artist) -> None:
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


async def test_list_owned_includes_private(
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


async def test_artist_public_list_excludes_private(
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
# items + reorder
# ---------------------------------------------------------------------------


async def test_add_remove_track_to_private_playlist(
    app_as_owner: FastAPI, db_session: AsyncSession, owner: Artist
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        playlist = await _create_private_playlist(client, "mine")
        add = await client.post(
            f"/lists/playlists/{playlist['id']}/tracks",
            json={"track_uri": "at://did:plc:x/c/r1", "track_cid": "bafy1"},
        )
        assert add.status_code == 200
        assert add.json()["track_count"] == 1

        remove = await client.delete(
            f"/lists/playlists/{playlist['id']}/tracks/at://did:plc:x/c/r1"
        )
        assert remove.status_code == 200
        assert remove.json()["track_count"] == 0


async def test_full_response_track_count_matches_hydrated_tracks(
    app_as_owner: FastAPI, db_session: AsyncSession, owner: Artist
) -> None:
    """get_playlist returns track_count == len(tracks), even when the
    cached count and the actual hydratable tracks disagree."""
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        playlist_resp = await _create_private_playlist(client, "stale-cache")
        # add an item but desync the cached count to simulate stale cache
        playlist = (
            await db_session.execute(
                select(Playlist).where(Playlist.id == playlist_resp["id"])
            )
        ).scalar_one()
        playlist.items_json = [{"uri": "at://did:plc:x/c/r1", "cid": "bafy1"}]
        playlist.track_count = 99  # cached count drifts
        await db_session.commit()

        full = await client.get(f"/lists/playlists/{playlist_resp['id']}")

    assert full.status_code == 200
    body = full.json()
    # there are no tracks in the DB matching the URI, so hydration produces []
    assert body["track_count"] == len(body["tracks"])


async def test_reorder_private_playlist(app_as_owner: FastAPI, owner: Artist) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        playlist = await _create_private_playlist(client, "mine")
        for i in (1, 2, 3):
            await client.post(
                f"/lists/playlists/{playlist['id']}/tracks",
                json={
                    "track_uri": f"at://did:plc:x/c/r{i}",
                    "track_cid": f"bafy{i}",
                },
            )

        reorder = await client.put(
            f"/lists/playlists/{playlist['id']}/reorder",
            json={
                "items": [
                    {"uri": "at://did:plc:x/c/r3", "cid": "bafy3"},
                    {"uri": "at://did:plc:x/c/r1", "cid": "bafy1"},
                    {"uri": "at://did:plc:x/c/r2", "cid": "bafy2"},
                ]
            },
        )

    assert reorder.status_code == 200
    assert reorder.json()["track_count"] == 3


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


async def test_delete_private_playlist(
    app_as_owner: FastAPI, db_session: AsyncSession, owner: Artist
) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app_as_owner), base_url="http://test"
    ) as client:
        playlist = await _create_private_playlist(client, "doomed")
        resp = await client.delete(f"/lists/playlists/{playlist['id']}")

    assert resp.status_code == 200
    remaining = (
        await db_session.execute(select(Playlist).where(Playlist.id == playlist["id"]))
    ).scalar_one_or_none()
    assert remaining is None


# ---------------------------------------------------------------------------
# leak prevention — non-members can't even tell a private playlist exists
# ---------------------------------------------------------------------------


async def test_non_owner_mutation_returns_404_not_403_for_private(
    db_session: AsyncSession, owner: Artist, viewer: Artist
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

    async def auth_viewer() -> Session:
        return MockSession(did="did:plc:viewer")

    app.dependency_overrides[require_auth] = auth_viewer
    app.dependency_overrides[get_optional_session] = auth_viewer
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            patch = await client.patch(
                f"/lists/playlists/{playlist['id']}",
                data={"name": "trying"},
            )
            add = await client.post(
                f"/lists/playlists/{playlist['id']}/tracks",
                json={"track_uri": "at://did:plc:x/c/r", "track_cid": "bafyx"},
            )
            remove = await client.delete(
                f"/lists/playlists/{playlist['id']}/tracks/at://did:plc:x/c/r"
            )
            reorder = await client.put(
                f"/lists/playlists/{playlist['id']}/reorder",
                json={"items": []},
            )
            delete = await client.delete(f"/lists/playlists/{playlist['id']}")
    finally:
        app.dependency_overrides.clear()

    for resp in (patch, add, remove, reorder, delete):
        assert resp.status_code == 404, (
            f"expected 404 (no existence leak) got {resp.status_code}"
        )


async def test_private_playlist_not_in_search(
    db_session: AsyncSession, owner: Artist
) -> None:
    async def auth_owner() -> Session:
        return MockSession(did="did:plc:owner")

    app.dependency_overrides[require_auth] = auth_owner
    app.dependency_overrides[get_optional_session] = auth_owner
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await _create_private_playlist(client, "uniquesecretname")
            resp = await client.get("/search/", params={"q": "uniquesecretname"})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert all(
        "uniquesecretname" not in (p.get("name") or "")
        for p in body.get("playlists", [])
    )


async def test_private_playlist_oembed_returns_404(
    db_session: AsyncSession, owner: Artist
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

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=True,
    ) as client:
        resp = await client.get(
            "/oembed",
            params={"url": f"http://localhost/playlist/{playlist['id']}"},
        )

    assert resp.status_code == 404


async def test_private_playlist_not_in_activity_feed(
    db_session: AsyncSession, owner: Artist
) -> None:
    async def auth_owner() -> Session:
        return MockSession(did="did:plc:owner")

    app.dependency_overrides[require_auth] = auth_owner
    app.dependency_overrides[get_optional_session] = auth_owner
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            await _create_private_playlist(client, "secret")
            resp = await client.get("/activity/")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    events = resp.json()["events"]
    for event in events:
        if event["type"] == "playlist_create":
            collection = event.get("collection") or {}
            assert collection.get("name") != "secret", (
                "private playlist leaked into activity feed"
            )

"""tests for playlist preview thumbnails (composite covers).

`preview_thumbnails` caches up to 4 distinct member-track artwork URLs in
playlist order so clients can render a composite cover when the playlist
has no explicit image. private playlists are used throughout — their items
live locally, so the full add/remove/list flow runs without a PDS.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session, require_auth
from backend.main import app
from backend.models import Artist, Playlist, Track


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
def app_as_owner() -> Generator[FastAPI, None, None]:
    async def _auth() -> Session:
        return MockSession(did="did:plc:owner")

    app.dependency_overrides[require_auth] = _auth
    app.dependency_overrides[get_optional_session] = _auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def tracks(db_session: AsyncSession, owner: Artist) -> list[Track]:
    """six tracks: 0-3 have distinct art, 4 has no art, 5 duplicates 0's art."""
    rows: list[Track] = []
    for i in range(6):
        if i == 4:
            thumbnail = None
            image = None
        elif i == 5:
            thumbnail = "https://img.test/thumb0.webp"
            image = "https://img.test/full0.jpg"
        else:
            thumbnail = f"https://img.test/thumb{i}.webp"
            image = f"https://img.test/full{i}.jpg"
        track = Track(
            title=f"Track {i}",
            file_id=f"previewtrack{i}",
            file_type="audio/mpeg",
            artist_did=owner.did,
            atproto_record_uri=f"at://did:plc:owner/fm.plyr.track/preview{i}",
            atproto_record_cid=f"bafypreview{i}",
            thumbnail_url=thumbnail,
            image_url=image,
        )
        db_session.add(track)
        rows.append(track)
    await db_session.commit()
    for track in rows:
        await db_session.refresh(track)
    return rows


def _client(test_app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=test_app), base_url="http://test")


async def _create_private_playlist(client: AsyncClient) -> dict:
    resp = await client.post(
        "/lists/playlists", json={"name": "mix", "is_private": True}
    )
    assert resp.status_code == 200
    return resp.json()


async def _add_track(client: AsyncClient, playlist_id: str, track: Track) -> dict:
    resp = await client.post(
        f"/lists/playlists/{playlist_id}/tracks",
        json={
            "track_uri": track.atproto_record_uri,
            "track_cid": track.atproto_record_cid,
        },
    )
    assert resp.status_code == 200
    return resp.json()


async def test_previews_follow_adds_in_order(
    app_as_owner: FastAPI, tracks: list[Track]
) -> None:
    async with _client(app_as_owner) as client:
        playlist = await _create_private_playlist(client)
        assert playlist["preview_thumbnails"] == []

        body = await _add_track(client, playlist["id"], tracks[1])
        assert body["preview_thumbnails"] == ["https://img.test/thumb1.webp"]

        body = await _add_track(client, playlist["id"], tracks[0])
        assert body["preview_thumbnails"] == [
            "https://img.test/thumb1.webp",
            "https://img.test/thumb0.webp",
        ]


async def test_previews_skip_artless_dedupe_and_cap_at_four(
    app_as_owner: FastAPI, tracks: list[Track]
) -> None:
    async with _client(app_as_owner) as client:
        playlist = await _create_private_playlist(client)
        # artless first, then a duplicate of track 0's art, then all four
        # distinct arts — expect the four distinct thumbnails in item order
        for track in [tracks[4], tracks[5], tracks[0], tracks[1], tracks[2], tracks[3]]:
            body = await _add_track(client, playlist["id"], track)

        assert body["preview_thumbnails"] == [
            "https://img.test/thumb0.webp",
            "https://img.test/thumb1.webp",
            "https://img.test/thumb2.webp",
            "https://img.test/thumb3.webp",
        ]


async def test_previews_refresh_on_remove(
    app_as_owner: FastAPI, tracks: list[Track]
) -> None:
    async with _client(app_as_owner) as client:
        playlist = await _create_private_playlist(client)
        await _add_track(client, playlist["id"], tracks[0])
        await _add_track(client, playlist["id"], tracks[1])

        resp = await client.request(
            "DELETE",
            f"/lists/playlists/{playlist['id']}/tracks/{tracks[0].atproto_record_uri}",
        )
        assert resp.status_code == 200
        assert resp.json()["preview_thumbnails"] == ["https://img.test/thumb1.webp"]


async def test_legacy_private_playlist_heals_on_list(
    app_as_owner: FastAPI,
    db_session: AsyncSession,
    owner: Artist,
    tracks: list[Track],
) -> None:
    """playlists created before the preview cache have `None`; the list
    endpoint backfills private ones from their local items."""
    playlist = Playlist(
        owner_did=owner.did,
        name="legacy",
        is_private=True,
        items_json=[
            {"uri": tracks[2].atproto_record_uri, "cid": "c"},
            {"uri": tracks[0].atproto_record_uri, "cid": "c"},
        ],
        track_count=2,
        preview_thumbnails=None,
    )
    db_session.add(playlist)
    await db_session.commit()

    async with _client(app_as_owner) as client:
        resp = await client.get("/lists/playlists")

    assert resp.status_code == 200
    listed = {p["id"]: p for p in resp.json()}
    assert listed[playlist.id]["preview_thumbnails"] == [
        "https://img.test/thumb2.webp",
        "https://img.test/thumb0.webp",
    ]

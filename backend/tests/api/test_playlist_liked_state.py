"""tests for playlist track liked state (regression test for liked state bug)."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend.main import app
from backend.models import Artist, Playlist, Track, TrackLike


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "testuser.bsky.social",
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
async def test_artist(db_session: AsyncSession) -> Artist:
    """create a test artist (owns the playlist)."""
    artist = Artist(
        did="did:plc:playlistowner",
        handle="owner.bsky.social",
        display_name="Playlist Owner",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def test_track_artist(db_session: AsyncSession) -> Artist:
    """create a test artist (owns the tracks)."""
    artist = Artist(
        did="did:plc:trackartist",
        handle="trackartist.bsky.social",
        display_name="Track Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def test_tracks(
    db_session: AsyncSession, test_track_artist: Artist
) -> list[Track]:
    """create test tracks with ATProto records."""
    tracks = []
    for i in range(3):
        track = Track(
            title=f"Track {i + 1}",
            file_id=f"playlisttrack{i}",
            file_type="audio/mpeg",
            artist_did=test_track_artist.did,
            atproto_record_uri=f"at://did:plc:trackartist/fm.plyr.track/track{i}",
            atproto_record_cid=f"bafytrack{i}",
        )
        db_session.add(track)
        tracks.append(track)

    await db_session.commit()
    for track in tracks:
        await db_session.refresh(track)

    return tracks


@pytest.fixture
async def test_playlist(
    db_session: AsyncSession, test_artist: Artist, test_tracks: list[Track]
) -> Playlist:
    """create a test playlist with ATProto record."""
    playlist = Playlist(
        id="test-playlist-id",
        name="Test Playlist",
        owner_did=test_artist.did,
        atproto_record_uri=f"at://{test_artist.did}/fm.plyr.playlist/testplaylist",
        atproto_record_cid="bafyplaylistcid123",
        track_count=len(test_tracks),
    )
    db_session.add(playlist)
    await db_session.commit()
    await db_session.refresh(playlist)
    return playlist


@pytest.fixture
async def liked_track(db_session: AsyncSession, test_tracks: list[Track]) -> TrackLike:
    """create a like for the first track by the test user."""
    like = TrackLike(
        user_did="did:test:user123",
        track_id=test_tracks[0].id,
        atproto_like_uri=f"at://did:test:user123/app.bsky.feed.like/{test_tracks[0].id}",
    )
    db_session.add(like)
    await db_session.commit()
    await db_session.refresh(like)
    return like


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app (no auth override - uses session cookie)."""
    yield app


async def test_playlist_returns_liked_state_for_authenticated_user(
    db_session: AsyncSession,
    test_app: FastAPI,
    test_artist: Artist,
    test_tracks: list[Track],
    test_playlist: Playlist,
    liked_track: TrackLike,
):
    """test that playlist endpoint returns is_liked=True for authenticated user's liked tracks.

    this is a regression test for the bug where playlist tracks never showed
    the liked state even when the user had liked them.
    """
    # mock the ATProto record fetch to return our test tracks
    mock_record_data = {
        "value": {
            "items": [
                {
                    "subject": {
                        "uri": track.atproto_record_uri,
                        "cid": track.atproto_record_cid,
                    }
                }
                for track in test_tracks
            ]
        }
    }

    # mock get_session to return our test user session
    mock_session = MockSession()

    with (
        patch(
            "backend._internal.atproto.records.get_record_public",
            new_callable=AsyncMock,
            return_value=mock_record_data,
        ),
        patch(
            "backend.api.lists.get_session",
            new_callable=AsyncMock,
            return_value=mock_session,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app),
            base_url="http://test",
            cookies={"session_id": "test_session_id"},
        ) as client:
            response = await client.get(f"/lists/playlists/{test_playlist.id}")

    assert response.status_code == 200
    data = response.json()

    # verify playlist metadata
    assert data["name"] == "Test Playlist"
    assert len(data["tracks"]) == 3

    # the first track should be marked as liked
    assert data["tracks"][0]["is_liked"] is True
    assert data["tracks"][0]["title"] == "Track 1"

    # other tracks should not be liked
    assert data["tracks"][1]["is_liked"] is False
    assert data["tracks"][2]["is_liked"] is False


async def test_playlist_returns_no_liked_state_for_unauthenticated_user(
    db_session: AsyncSession,
    test_app: FastAPI,
    test_artist: Artist,
    test_tracks: list[Track],
    test_playlist: Playlist,
    liked_track: TrackLike,
):
    """test that playlist endpoint returns is_liked=False for all tracks when not authenticated.

    even if tracks have likes, unauthenticated users should not see their own liked state.
    """
    # mock the ATProto record fetch to return our test tracks
    mock_record_data = {
        "value": {
            "items": [
                {
                    "subject": {
                        "uri": track.atproto_record_uri,
                        "cid": track.atproto_record_cid,
                    }
                }
                for track in test_tracks
            ]
        }
    }

    with (
        patch(
            "backend._internal.atproto.records.get_record_public",
            new_callable=AsyncMock,
            return_value=mock_record_data,
        ),
        patch(
            "backend.api.lists.get_session",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app),
            base_url="http://test",
        ) as client:
            response = await client.get(f"/lists/playlists/{test_playlist.id}")

    assert response.status_code == 200
    data = response.json()

    # all tracks should have is_liked=False when not authenticated
    for track in data["tracks"]:
        assert track["is_liked"] is False

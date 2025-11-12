"""tests for artist analytics endpoints."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track, TrackLike


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
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


@pytest.fixture
async def artist_with_tracks(db_session: AsyncSession) -> Artist:
    """create artist with tracks having different play counts and likes."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create tracks with varying play counts
    tracks = [
        Track(
            title="Most Played",
            artist_did=artist.did,
            file_id="file_1",
            file_type="mp3",
            play_count=100,
            atproto_record_uri="at://did:plc:artist123/fm.plyr.track/1",
            atproto_record_cid="cid_1",
        ),
        Track(
            title="Most Liked",
            artist_did=artist.did,
            file_id="file_2",
            file_type="mp3",
            play_count=50,
            atproto_record_uri="at://did:plc:artist123/fm.plyr.track/2",
            atproto_record_cid="cid_2",
        ),
        Track(
            title="Least Popular",
            artist_did=artist.did,
            file_id="file_3",
            file_type="mp3",
            play_count=10,
            atproto_record_uri="at://did:plc:artist123/fm.plyr.track/3",
            atproto_record_cid="cid_3",
        ),
    ]

    for track in tracks:
        db_session.add(track)

    await db_session.commit()

    # refresh to get IDs
    for track in tracks:
        await db_session.refresh(track)

    # add likes: "Most Liked" gets 5 likes, "Most Played" gets 2 likes
    likes = []
    for i in range(5):
        likes.append(
            TrackLike(
                track_id=tracks[1].id,  # Most Liked
                user_did=f"did:test:user{i}",
                atproto_like_uri=f"at://did:test:user{i}/fm.plyr.like/1",
            )
        )

    for i in range(2):
        likes.append(
            TrackLike(
                track_id=tracks[0].id,  # Most Played
                user_did=f"did:test:user{i + 10}",
                atproto_like_uri=f"at://did:test:user{i + 10}/fm.plyr.like/1",
            )
        )

    for like in likes:
        db_session.add(like)

    await db_session.commit()

    return artist


async def test_get_artist_analytics_with_likes(
    test_app: FastAPI, db_session: AsyncSession, artist_with_tracks: Artist
):
    """test analytics returns both top played and top liked tracks."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/artists/{artist_with_tracks.did}/analytics")

    assert response.status_code == 200
    data = response.json()

    # verify total metrics
    assert data["total_plays"] == 160  # 100 + 50 + 10
    assert data["total_items"] == 3

    # verify top played track
    assert data["top_item"]["title"] == "Most Played"
    assert data["top_item"]["play_count"] == 100

    # verify top liked track
    assert data["top_liked"]["title"] == "Most Liked"
    assert data["top_liked"]["play_count"] == 5  # like count


async def test_get_artist_analytics_no_tracks(
    test_app: FastAPI, db_session: AsyncSession
):
    """test analytics returns zeros for artist with no tracks."""
    # create artist with no tracks
    artist = Artist(
        did="did:plc:newartist",
        handle="newartist.bsky.social",
        display_name="New Artist",
    )
    db_session.add(artist)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/artists/{artist.did}/analytics")

    assert response.status_code == 200
    data = response.json()

    assert data["total_plays"] == 0
    assert data["total_items"] == 0
    assert data["top_item"] is None
    assert data["top_liked"] is None


async def test_get_artist_analytics_no_likes(
    test_app: FastAPI, db_session: AsyncSession
):
    """test analytics when artist has tracks but no likes."""
    artist = Artist(
        did="did:plc:artist456",
        handle="artist456.bsky.social",
        display_name="Test Artist 2",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Unloved Track",
        artist_did=artist.did,
        file_id="file_1",
        file_type="mp3",
        play_count=50,
        atproto_record_uri="at://did:plc:artist456/fm.plyr.track/1",
        atproto_record_cid="cid_1",
    )
    db_session.add(track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/artists/{artist.did}/analytics")

    assert response.status_code == 200
    data = response.json()

    assert data["total_plays"] == 50
    assert data["total_items"] == 1
    assert data["top_item"]["title"] == "Unloved Track"
    assert data["top_liked"] is None  # no likes

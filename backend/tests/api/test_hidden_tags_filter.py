"""tests for hidden tags filtering on track listing endpoints."""

from collections.abc import Generator
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Tag, Track, TrackTag, UserPreferences, get_db


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
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def ai_tag(db_session: AsyncSession, artist: Artist) -> Tag:
    """create an 'ai' tag."""
    tag = Tag(name="ai", created_by_did=artist.did)
    db_session.add(tag)
    await db_session.commit()
    await db_session.refresh(tag)
    return tag


@pytest.fixture
async def regular_track(db_session: AsyncSession, artist: Artist) -> Track:
    """create a track without any tags."""
    track = Track(
        title="Regular Track",
        artist_did=artist.did,
        file_id="regular123",
        file_type="mp3",
        extra={"duration": 180},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/regular123",
        atproto_record_cid="bafyregular123",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
async def ai_tagged_track(
    db_session: AsyncSession, artist: Artist, ai_tag: Tag
) -> Track:
    """create a track tagged with 'ai'."""
    track = Track(
        title="AI Generated Track",
        artist_did=artist.did,
        file_id="aitrack123",
        file_type="mp3",
        extra={"duration": 120},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/aitrack123",
        atproto_record_cid="bafyaitrack123",
    )
    db_session.add(track)
    await db_session.flush()

    track_tag = TrackTag(track_id=track.id, tag_id=ai_tag.id)
    db_session.add(track_tag)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
async def user_with_hidden_ai_tag(
    db_session: AsyncSession,
) -> UserPreferences:
    """create user preferences with 'ai' as hidden tag."""
    prefs = UserPreferences(
        did="did:test:user123",
        hidden_tags=["ai"],
    )
    db_session.add(prefs)
    await db_session.commit()
    await db_session.refresh(prefs)
    return prefs


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth and db."""

    async def mock_require_auth() -> Session:
        return MockSession()

    async def mock_get_session(session_id: str) -> Session | None:
        if session_id == "test_session":
            return MockSession()
        return None

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[require_auth] = mock_require_auth
    app.dependency_overrides[get_db] = mock_get_db

    with patch("backend.api.tracks.listing.get_session", mock_get_session):
        yield app

    app.dependency_overrides.clear()


async def test_discovery_feed_filters_hidden_tags_by_default(
    test_app: FastAPI,
    db_session: AsyncSession,
    regular_track: Track,
    ai_tagged_track: Track,
    user_with_hidden_ai_tag: UserPreferences,
):
    """test that discovery feed (no artist_did) filters hidden tags."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/tracks/",
            cookies={"session_id": "test_session"},
        )

    assert response.status_code == 200
    tracks = response.json()["tracks"]
    track_titles = [t["title"] for t in tracks]

    # regular track should be visible
    assert "Regular Track" in track_titles
    # ai-tagged track should be hidden
    assert "AI Generated Track" not in track_titles


async def test_artist_page_shows_all_tracks_by_default(
    test_app: FastAPI,
    db_session: AsyncSession,
    artist: Artist,
    regular_track: Track,
    ai_tagged_track: Track,
    user_with_hidden_ai_tag: UserPreferences,
):
    """test that artist page (with artist_did) shows all tracks including hidden."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            f"/tracks/?artist_did={artist.did}",
            cookies={"session_id": "test_session"},
        )

    assert response.status_code == 200
    tracks = response.json()["tracks"]
    track_titles = [t["title"] for t in tracks]

    # both tracks should be visible on artist page
    assert "Regular Track" in track_titles
    assert "AI Generated Track" in track_titles


async def test_explicit_filter_hidden_tags_true_forces_filtering(
    test_app: FastAPI,
    db_session: AsyncSession,
    artist: Artist,
    regular_track: Track,
    ai_tagged_track: Track,
    user_with_hidden_ai_tag: UserPreferences,
):
    """test that filter_hidden_tags=true forces filtering even on artist page."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            f"/tracks/?artist_did={artist.did}&filter_hidden_tags=true",
            cookies={"session_id": "test_session"},
        )

    assert response.status_code == 200
    tracks = response.json()["tracks"]
    track_titles = [t["title"] for t in tracks]

    # only regular track should be visible with explicit filtering
    assert "Regular Track" in track_titles
    assert "AI Generated Track" not in track_titles


async def test_explicit_filter_hidden_tags_false_disables_filtering(
    test_app: FastAPI,
    db_session: AsyncSession,
    regular_track: Track,
    ai_tagged_track: Track,
    user_with_hidden_ai_tag: UserPreferences,
):
    """test that filter_hidden_tags=false disables filtering on discovery feed."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/tracks/?filter_hidden_tags=false",
            cookies={"session_id": "test_session"},
        )

    assert response.status_code == 200
    tracks = response.json()["tracks"]
    track_titles = [t["title"] for t in tracks]

    # both tracks should be visible with filtering disabled
    assert "Regular Track" in track_titles
    assert "AI Generated Track" in track_titles


async def test_unauthenticated_user_gets_default_hidden_tags(
    test_app: FastAPI,
    db_session: AsyncSession,
    regular_track: Track,
    ai_tagged_track: Track,
):
    """test that unauthenticated users get default hidden tags applied."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # no session cookie - unauthenticated
        response = await client.get("/tracks/")

    assert response.status_code == 200
    tracks = response.json()["tracks"]
    track_titles = [t["title"] for t in tracks]

    # default hidden tags include 'ai', so ai-tagged track should be hidden
    assert "Regular Track" in track_titles
    assert "AI Generated Track" not in track_titles

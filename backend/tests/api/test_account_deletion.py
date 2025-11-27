"""tests for account deletion functionality."""

import json
from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import (
    Album,
    Artist,
    QueueState,
    Track,
    TrackComment,
    TrackLike,
    UserPreferences,
    UserSession,
)


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(
        self, did: str = "did:test:user123", handle: str = "testuser.bsky.social"
    ):
        self.did = did
        self.handle = handle
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": handle,
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


TEST_DID = "did:plc:testuser123"
TEST_HANDLE = "testuser.bsky.social"


@pytest.fixture
async def test_artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did=TEST_DID,
        handle=TEST_HANDLE,
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession(did=TEST_DID, handle=TEST_HANDLE)

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


async def _delete_account(
    client: AsyncClient, confirmation: str, delete_atproto: bool = False
):
    """helper to make DELETE request with JSON body."""
    return await client.request(
        "DELETE",
        "/account/",
        json={"confirmation": confirmation, "delete_atproto_records": delete_atproto},
    )


async def test_delete_account_requires_confirmation(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion requires matching handle confirmation."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await _delete_account(client, "wrong.handle")

    assert response.status_code == 400
    assert "confirmation must match your handle" in response.json()["detail"]


async def test_delete_account_deletes_tracks(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes all user tracks."""
    track1 = Track(
        title="track 1",
        artist_did=TEST_DID,
        file_id="file1",
        file_type="mp3",
        extra={},
    )
    track2 = Track(
        title="track 2",
        artist_did=TEST_DID,
        file_id="file2",
        file_type="mp3",
        extra={},
    )
    db_session.add_all([track1, track2])
    await db_session.commit()

    result = await db_session.execute(select(Track).where(Track.artist_did == TEST_DID))
    assert len(result.scalars().all()) == 2

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200
    assert response.json()["deleted"]["tracks"] == 2

    result = await db_session.execute(select(Track).where(Track.artist_did == TEST_DID))
    assert len(result.scalars().all()) == 0


async def test_delete_account_deletes_albums(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes all user albums."""
    album = Album(
        artist_did=TEST_DID,
        slug="test-album",
        title="Test Album",
    )
    db_session.add(album)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200
    assert response.json()["deleted"]["albums"] == 1

    result = await db_session.execute(select(Album).where(Album.artist_did == TEST_DID))
    assert result.scalar_one_or_none() is None


async def test_delete_account_deletes_likes_given(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes likes given by the user."""
    other_artist = Artist(
        did="did:plc:other",
        handle="other.bsky.social",
        display_name="Other Artist",
    )
    db_session.add(other_artist)
    await db_session.flush()

    other_track = Track(
        title="other track",
        artist_did=other_artist.did,
        file_id="other_file",
        file_type="mp3",
        extra={},
    )
    db_session.add(other_track)
    await db_session.flush()

    like = TrackLike(
        track_id=other_track.id,
        user_did=TEST_DID,
        atproto_like_uri="at://did:plc:testuser123/fm.plyr.like/abc",
    )
    db_session.add(like)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200
    assert response.json()["deleted"]["likes"] == 1

    result = await db_session.execute(
        select(TrackLike).where(TrackLike.user_did == TEST_DID)
    )
    assert result.scalar_one_or_none() is None


async def test_delete_account_deletes_comments_made(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes comments made by the user."""
    other_artist = Artist(
        did="did:plc:other",
        handle="other.bsky.social",
        display_name="Other Artist",
    )
    db_session.add(other_artist)
    await db_session.flush()

    other_track = Track(
        title="other track",
        artist_did=other_artist.did,
        file_id="other_file",
        file_type="mp3",
        extra={},
    )
    db_session.add(other_track)
    await db_session.flush()

    comment = TrackComment(
        track_id=other_track.id,
        user_did=TEST_DID,
        text="nice track!",
        timestamp_ms=30000,
        atproto_comment_uri="at://did:plc:testuser123/fm.plyr.comment/xyz",
    )
    db_session.add(comment)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200
    assert response.json()["deleted"]["comments"] == 1

    result = await db_session.execute(
        select(TrackComment).where(TrackComment.user_did == TEST_DID)
    )
    assert result.scalar_one_or_none() is None


async def test_delete_account_deletes_preferences(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes user preferences."""
    prefs = UserPreferences(
        did=TEST_DID,
        accent_color="#ff0000",
        auto_advance=True,
        allow_comments=True,
    )
    db_session.add(prefs)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200

    result = await db_session.execute(
        select(UserPreferences).where(UserPreferences.did == TEST_DID)
    )
    assert result.scalar_one_or_none() is None


async def test_delete_account_deletes_sessions(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes all user sessions."""
    session = UserSession(
        did=TEST_DID,
        handle=TEST_HANDLE,
        session_id="session123",
        oauth_session_data=json.dumps({"token": "fake"}),
    )
    db_session.add(session)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200

    result = await db_session.execute(
        select(UserSession).where(UserSession.did == TEST_DID)
    )
    assert result.scalar_one_or_none() is None


async def test_delete_account_deletes_queue(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes user queue state."""
    queue = QueueState(
        did=TEST_DID,
        state={"track_ids": [1, 2, 3], "current_index": 0},
    )
    db_session.add(queue)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200

    result = await db_session.execute(
        select(QueueState).where(QueueState.did == TEST_DID)
    )
    assert result.scalar_one_or_none() is None


async def test_delete_account_with_atproto_records(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion can delete ATProto records when requested."""
    track = Track(
        title="track with atproto",
        artist_did=TEST_DID,
        file_id="file_atproto",
        file_type="mp3",
        extra={},
        atproto_record_uri="at://did:plc:testuser123/fm.plyr.track/abc",
    )
    db_session.add(track)
    await db_session.commit()

    with (
        patch("backend.api.account.storage.delete", new_callable=AsyncMock),
        patch(
            "backend.api.account.delete_record_by_uri", new_callable=AsyncMock
        ) as mock_delete_atproto,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE, delete_atproto=True)

    assert response.status_code == 200
    assert response.json()["deleted"]["atproto_records"] == 1

    mock_delete_atproto.assert_called_once()


async def test_delete_account_deletes_r2_objects(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes R2 objects."""
    track = Track(
        title="track with media",
        artist_did=TEST_DID,
        file_id="audio_file",
        file_type="mp3",
        extra={},
        image_id="image_file",
    )
    db_session.add(track)
    await db_session.commit()

    delete_calls: list[tuple[str, str | None]] = []

    async def mock_delete(file_id: str, file_type: str | None = None) -> bool:
        delete_calls.append((file_id, file_type))
        return True

    with patch("backend.api.account.storage.delete", side_effect=mock_delete):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200
    assert response.json()["deleted"]["r2_objects"] == 2

    deleted_ids = [call[0] for call in delete_calls]
    assert "audio_file" in deleted_ids
    assert "image_file" in deleted_ids


async def test_delete_account_deletes_likes_on_user_tracks(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes likes from OTHER users on the user's tracks."""
    track = Track(
        title="my track",
        artist_did=TEST_DID,
        file_id="my_file",
        file_type="mp3",
        extra={},
    )
    db_session.add(track)
    await db_session.flush()

    other_like = TrackLike(
        track_id=track.id,
        user_did="did:plc:other",
        atproto_like_uri="at://did:plc:other/fm.plyr.like/xyz",
    )
    db_session.add(other_like)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200

    result = await db_session.execute(
        select(TrackLike).where(TrackLike.track_id == track.id)
    )
    assert result.scalar_one_or_none() is None


async def test_delete_account_deletes_comments_on_user_tracks(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that account deletion removes comments from OTHER users on the user's tracks."""
    track = Track(
        title="my track",
        artist_did=TEST_DID,
        file_id="my_file",
        file_type="mp3",
        extra={},
    )
    db_session.add(track)
    await db_session.flush()

    other_comment = TrackComment(
        track_id=track.id,
        user_did="did:plc:other",
        text="great track!",
        timestamp_ms=15000,
        atproto_comment_uri="at://did:plc:other/fm.plyr.comment/xyz",
    )
    db_session.add(other_comment)
    await db_session.commit()

    with patch("backend.api.account.storage.delete", new_callable=AsyncMock):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await _delete_account(client, TEST_HANDLE)

    assert response.status_code == 200

    result = await db_session.execute(
        select(TrackComment).where(TrackComment.track_id == track.id)
    )
    assert result.scalar_one_or_none() is None

"""tests for ATProto list record sync on login."""

import asyncio
from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Album, Artist, Track, TrackLike


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
        return MockSession(did="did:plc:testartist123")

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


@pytest.fixture
async def test_artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:testartist123",
        handle="testartist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def test_album_with_tracks(
    db_session: AsyncSession, test_artist: Artist
) -> tuple[Album, list[Track]]:
    """create a test album with tracks that have ATProto records."""
    album = Album(
        artist_did=test_artist.did,
        title="Test Album",
        slug="test-album",
    )
    db_session.add(album)
    await db_session.flush()

    tracks = []
    for i in range(3):
        track = Track(
            title=f"Track {i + 1}",
            file_id=f"fileid{i}",
            file_type="audio/mpeg",
            artist_did=test_artist.did,
            album_id=album.id,
            atproto_record_uri=f"at://did:plc:testartist123/fm.plyr.track/track{i}",
            atproto_record_cid=f"bafytrack{i}",
        )
        db_session.add(track)
        tracks.append(track)

    await db_session.commit()
    for track in tracks:
        await db_session.refresh(track)
    await db_session.refresh(album)

    return album, tracks


@pytest.fixture
async def test_liked_tracks(
    db_session: AsyncSession, test_artist: Artist
) -> list[Track]:
    """create tracks liked by the test user."""
    # create another artist who owns the tracks
    other_artist = Artist(
        did="did:plc:otherartist",
        handle="otherartist.bsky.social",
        display_name="Other Artist",
    )
    db_session.add(other_artist)

    tracks = []
    for i in range(2):
        track = Track(
            title=f"Liked Track {i + 1}",
            file_id=f"likedfileid{i}",
            file_type="audio/mpeg",
            artist_did=other_artist.did,
            atproto_record_uri=f"at://did:plc:otherartist/fm.plyr.track/liked{i}",
            atproto_record_cid=f"bafyliked{i}",
        )
        db_session.add(track)
        tracks.append(track)

    await db_session.flush()

    # create likes from the test user
    for track in tracks:
        like = TrackLike(
            user_did="did:plc:testartist123",
            track_id=track.id,
            atproto_like_uri=f"at://did:plc:testartist123/fm.plyr.like/{track.id}",
        )
        db_session.add(like)

    await db_session.commit()
    for track in tracks:
        await db_session.refresh(track)

    return tracks


async def test_sync_atproto_records_syncs_albums(
    db_session: AsyncSession,
    test_artist: Artist,
    test_album_with_tracks: tuple[Album, list[Track]],
):
    """test that sync_atproto_records syncs album list records."""
    from backend._internal.atproto import sync_atproto_records

    album, _ = test_album_with_tracks
    mock_session = MockSession(did="did:plc:testartist123")

    with (
        patch(
            "backend._internal.atproto.sync.upsert_profile_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_album_list_record",
            new_callable=AsyncMock,
            return_value=(
                "at://did:plc:testartist123/fm.plyr.list/album123",
                "bafyalbum123",
            ),
        ) as mock_album_sync,
        patch(
            "backend._internal.atproto.sync.upsert_liked_list_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        await sync_atproto_records(mock_session, "did:plc:testartist123")

    # verify album sync was called with correct track refs
    mock_album_sync.assert_called_once()
    call_args = mock_album_sync.call_args
    assert call_args.kwargs["album_id"] == album.id
    assert call_args.kwargs["album_title"] == "Test Album"
    assert len(call_args.kwargs["track_refs"]) == 3


async def test_sync_atproto_records_syncs_liked_list(
    db_session: AsyncSession,
    test_artist: Artist,
    test_liked_tracks: list[Track],
):
    """test that sync_atproto_records syncs liked list record."""
    from backend._internal.atproto import sync_atproto_records

    mock_session = MockSession(did="did:plc:testartist123")

    with (
        patch(
            "backend._internal.atproto.sync.upsert_profile_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_album_list_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_liked_list_record",
            new_callable=AsyncMock,
            return_value=(
                "at://did:plc:testartist123/fm.plyr.list/liked456",
                "bafyliked456",
            ),
        ) as mock_liked_sync,
    ):
        await sync_atproto_records(mock_session, "did:plc:testartist123")

    # verify liked sync was called with correct track refs
    mock_liked_sync.assert_called_once()
    call_args = mock_liked_sync.call_args
    assert len(call_args.kwargs["track_refs"]) == 2


async def test_sync_atproto_records_skips_albums_without_atproto_tracks(
    db_session: AsyncSession, test_artist: Artist
):
    """test that albums with no ATProto-enabled tracks are skipped."""
    from backend._internal.atproto import sync_atproto_records

    # create album with tracks that have no ATProto records
    album = Album(
        artist_did=test_artist.did,
        title="Album Without ATProto",
        slug="album-without-atproto",
    )
    db_session.add(album)
    await db_session.flush()

    track = Track(
        title="Track Without ATProto",
        file_id="noatproto",
        file_type="audio/mpeg",
        artist_did=test_artist.did,
        album_id=album.id,
        atproto_record_uri=None,  # no ATProto record
        atproto_record_cid=None,
    )
    db_session.add(track)
    await db_session.commit()

    mock_session = MockSession(did="did:plc:testartist123")

    with (
        patch(
            "backend._internal.atproto.sync.upsert_profile_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_album_list_record",
            new_callable=AsyncMock,
        ) as mock_album_sync,
        patch(
            "backend._internal.atproto.sync.upsert_liked_list_record",
            new_callable=AsyncMock,
        ),
    ):
        await sync_atproto_records(mock_session, "did:plc:testartist123")

    # album sync should NOT be called for albums without ATProto tracks
    mock_album_sync.assert_not_called()


async def test_sync_atproto_records_continues_on_album_sync_failure(
    db_session: AsyncSession,
    test_artist: Artist,
    test_album_with_tracks: tuple[Album, list[Track]],
    test_liked_tracks: list[Track],
):
    """test that sync continues even if album sync fails."""
    from backend._internal.atproto import sync_atproto_records

    mock_session = MockSession(did="did:plc:testartist123")

    with (
        patch(
            "backend._internal.atproto.sync.upsert_profile_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_album_list_record",
            side_effect=Exception("PDS error"),
        ),
        patch(
            "backend._internal.atproto.sync.upsert_liked_list_record",
            new_callable=AsyncMock,
            return_value=None,
        ) as mock_liked_sync,
    ):
        # should not raise
        await sync_atproto_records(mock_session, "did:plc:testartist123")

    # liked sync should still be attempted (user has liked tracks)
    mock_liked_sync.assert_called_once()


async def test_sync_atproto_records_continues_on_liked_sync_failure(
    db_session: AsyncSession,
    test_artist: Artist,
    test_liked_tracks: list[Track],
):
    """test that sync completes even if liked sync fails."""
    from backend._internal.atproto import sync_atproto_records

    mock_session = MockSession(did="did:plc:testartist123")

    with (
        patch(
            "backend._internal.atproto.sync.upsert_profile_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_album_list_record",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend._internal.atproto.sync.upsert_liked_list_record",
            side_effect=Exception("PDS error"),
        ),
    ):
        # should not raise
        await sync_atproto_records(mock_session, "did:plc:testartist123")


async def test_login_callback_triggers_background_sync(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_artist: Artist,
):
    """test that OAuth callback triggers ATProto sync in background."""
    mock_oauth_session = {
        "did": "did:plc:testartist123",
        "handle": "testartist.bsky.social",
        "pds_url": "https://test.pds",
        "authserver_iss": "https://auth.test",
        "scope": "atproto transition:generic",
        "access_token": "test_token",
        "refresh_token": "test_refresh",
        "dpop_private_key_pem": "fake_key",
        "dpop_authserver_nonce": "",
        "dpop_pds_nonce": "",
    }

    with (
        patch(
            "backend.api.auth.handle_oauth_callback",
            new_callable=AsyncMock,
            return_value=(
                "did:plc:testartist123",
                "testartist.bsky.social",
                mock_oauth_session,
            ),
        ),
        patch(
            "backend.api.auth.get_pending_dev_token",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend.api.auth.get_pending_scope_upgrade",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend.api.auth.create_session",
            new_callable=AsyncMock,
            return_value="test_session_id",
        ),
        patch(
            "backend.api.auth.create_exchange_token",
            new_callable=AsyncMock,
            return_value="test_exchange_token",
        ),
        patch(
            "backend.api.auth.check_artist_profile_exists",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "backend.api.auth.sync_atproto_records",
            new_callable=AsyncMock,
        ) as mock_sync,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/auth/callback",
                params={
                    "code": "test_code",
                    "state": "test_state",
                    "iss": "https://auth.test",
                },
                follow_redirects=False,
            )

        # give background tasks time to run
        await asyncio.sleep(0.1)

    assert response.status_code == 303
    assert "exchange_token=test_exchange_token" in response.headers["location"]

    # verify sync was triggered in background
    mock_sync.assert_called_once()
    call_args = mock_sync.call_args
    # first arg is the session, second is the DID
    assert call_args[0][1] == "did:plc:testartist123"

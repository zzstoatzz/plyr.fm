"""tests for audio streaming endpoint."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track


@pytest.fixture
def mock_session() -> Session:
    """create a mock session for authenticated endpoints."""
    return Session(
        session_id="test-session-id",
        did="did:plc:testuser123",
        handle="testuser.bsky.social",
        oauth_session={
            "access_token": "test-access-token",
            "refresh_token": "test-refresh-token",
            "dpop_key": {},
        },
    )


@pytest.fixture
async def test_track_with_r2_url(db_session: AsyncSession) -> Track:
    """create a test track with r2_url."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Test Track",
        artist_did=artist.did,
        file_id="test123",
        file_type="mp3",
        r2_url="https://cdn.example.com/audio/test123.mp3",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
async def test_track_without_r2_url(db_session: AsyncSession) -> Track:
    """create a test track without r2_url (needs lookup)."""
    artist = Artist(
        did="did:plc:artist456",
        handle="artist2.bsky.social",
        display_name="Test Artist 2",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Test Track 2",
        artist_did=artist.did,
        file_id="test456",
        file_type="flac",
        r2_url=None,  # no cached URL
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
def test_app() -> FastAPI:
    """get test app."""
    return app


async def test_stream_audio_with_cached_url(
    test_app: FastAPI, test_track_with_r2_url: Track
):
    """test that storage uses cached r2_url directly (zero HEADs)."""
    # create mock storage
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock()

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_with_r2_url.file_id}", follow_redirects=False
            )

    assert response.status_code == 307
    assert response.headers["location"] == test_track_with_r2_url.r2_url
    # should NOT call get_url when r2_url is cached
    mock_storage.get_url.assert_not_called()


async def test_stream_audio_without_cached_url(
    test_app: FastAPI, test_track_without_r2_url: Track
):
    """test that storage calls get_url with extension when r2_url is None."""
    expected_url = "https://cdn.example.com/audio/test456.flac"

    # create mock storage
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=expected_url)

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_without_r2_url.file_id}", follow_redirects=False
            )

        # verify get_url was called with the correct extension
        mock_storage.get_url.assert_called_once_with(
            test_track_without_r2_url.file_id,
            file_type="audio",
            extension=test_track_without_r2_url.file_type,
        )

    assert response.status_code == 307
    assert response.headers["location"] == expected_url


async def test_stream_audio_track_not_found(test_app: FastAPI):
    """test that endpoint returns 404 when track doesn't exist in DB."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/audio/nonexistent", follow_redirects=False)

    assert response.status_code == 404
    assert response.json()["detail"] == "audio file not found"


async def test_stream_audio_file_not_in_storage(
    test_app: FastAPI, test_track_without_r2_url: Track
):
    """test that endpoint returns 404 when get_url returns None."""
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=None)

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_without_r2_url.file_id}", follow_redirects=False
            )

    assert response.status_code == 404
    assert response.json()["detail"] == "audio file not found"


# tests for /audio/{file_id}/url endpoint (offline caching, requires auth)


async def test_get_audio_url_with_cached_url(
    test_app: FastAPI, test_track_with_r2_url: Track, mock_session: Session
):
    """test that /url endpoint returns cached r2_url as JSON."""
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock()

    test_app.dependency_overrides[require_auth] = lambda: mock_session

    try:
        with patch("backend.api.audio.storage", mock_storage):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/audio/{test_track_with_r2_url.file_id}/url"
                )

        assert response.status_code == 200
        data = response.json()
        assert data["url"] == test_track_with_r2_url.r2_url
        assert data["file_id"] == test_track_with_r2_url.file_id
        assert data["file_type"] == test_track_with_r2_url.file_type
        # should NOT call get_url when r2_url is cached
        mock_storage.get_url.assert_not_called()
    finally:
        test_app.dependency_overrides.pop(require_auth, None)


async def test_get_audio_url_without_cached_url(
    test_app: FastAPI, test_track_without_r2_url: Track, mock_session: Session
):
    """test that /url endpoint calls storage.get_url when r2_url is None."""
    expected_url = "https://cdn.example.com/audio/test456.flac"

    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=expected_url)

    test_app.dependency_overrides[require_auth] = lambda: mock_session

    try:
        with patch("backend.api.audio.storage", mock_storage):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/audio/{test_track_without_r2_url.file_id}/url"
                )

        assert response.status_code == 200
        data = response.json()
        assert data["url"] == expected_url
        assert data["file_id"] == test_track_without_r2_url.file_id
        assert data["file_type"] == test_track_without_r2_url.file_type

        mock_storage.get_url.assert_called_once_with(
            test_track_without_r2_url.file_id,
            file_type="audio",
            extension=test_track_without_r2_url.file_type,
        )
    finally:
        test_app.dependency_overrides.pop(require_auth, None)


async def test_get_audio_url_not_found(test_app: FastAPI, mock_session: Session):
    """test that /url endpoint returns 404 for nonexistent track."""
    test_app.dependency_overrides[require_auth] = lambda: mock_session

    try:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/audio/nonexistent/url")

        assert response.status_code == 404
        assert response.json()["detail"] == "audio file not found"
    finally:
        test_app.dependency_overrides.pop(require_auth, None)


async def test_get_audio_url_storage_returns_none(
    test_app: FastAPI, test_track_without_r2_url: Track, mock_session: Session
):
    """test that /url endpoint returns 404 when storage.get_url returns None."""
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=None)

    test_app.dependency_overrides[require_auth] = lambda: mock_session

    try:
        with patch("backend.api.audio.storage", mock_storage):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/audio/{test_track_without_r2_url.file_id}/url"
                )

        assert response.status_code == 404
        assert response.json()["detail"] == "audio file not found"
    finally:
        test_app.dependency_overrides.pop(require_auth, None)


async def test_get_audio_url_gated_requires_auth(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that /url endpoint returns 401 for gated content without authentication."""
    # create a gated track
    artist = Artist(
        did="did:plc:gatedartist",
        handle="gatedartist.bsky.social",
        display_name="Gated Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Gated Track",
        artist_did=artist.did,
        file_id="gated-test-file",
        file_type="mp3",
        r2_url="https://cdn.example.com/audio/gated.mp3",
        support_gate={"type": "any"},
    )
    db_session.add(track)
    await db_session.commit()

    # ensure no auth override
    test_app.dependency_overrides.pop(require_auth, None)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/audio/{track.file_id}/url")

    assert response.status_code == 401
    assert "authentication required" in response.json()["detail"]


# gated content regression tests


@pytest.fixture
async def gated_track(db_session: AsyncSession) -> Track:
    """create a gated track for testing supporter access."""
    artist = Artist(
        did="did:plc:gatedowner",
        handle="gatedowner.bsky.social",
        display_name="Gated Owner",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Supporters Only Track",
        artist_did=artist.did,
        file_id="gated-regression-test",
        file_type="mp3",
        r2_url=None,  # no cached URL - forces presigned URL generation
        support_gate={"type": "any"},
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
def owner_session() -> Session:
    """session for the track owner."""
    return Session(
        session_id="owner-session-id",
        did="did:plc:gatedowner",
        handle="gatedowner.bsky.social",
        oauth_session={
            "access_token": "owner-access-token",
            "refresh_token": "owner-refresh-token",
            "dpop_key": {},
        },
    )


@pytest.fixture
def non_supporter_session() -> Session:
    """session for a user who is not a supporter."""
    return Session(
        session_id="non-supporter-session-id",
        did="did:plc:randomuser",
        handle="randomuser.bsky.social",
        oauth_session={
            "access_token": "random-access-token",
            "refresh_token": "random-refresh-token",
            "dpop_key": {},
        },
    )


async def test_gated_stream_requires_auth(test_app: FastAPI, gated_track: Track):
    """regression: GET /audio/{file_id} returns 401 for gated content without auth."""
    test_app.dependency_overrides.pop(require_auth, None)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            f"/audio/{gated_track.file_id}", follow_redirects=False
        )

    assert response.status_code == 401
    assert "authentication required" in response.json()["detail"]


async def test_gated_head_requires_auth(test_app: FastAPI, gated_track: Track):
    """regression: HEAD /audio/{file_id} returns 401 for gated content without auth."""
    test_app.dependency_overrides.pop(require_auth, None)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.head(f"/audio/{gated_track.file_id}")

    assert response.status_code == 401


async def test_gated_head_owner_allowed(
    test_app: FastAPI, gated_track: Track, owner_session: Session
):
    """regression: HEAD /audio/{file_id} returns 200 for track owner."""
    from backend._internal import get_optional_session

    test_app.dependency_overrides[get_optional_session] = lambda: owner_session

    try:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.head(f"/audio/{gated_track.file_id}")

        assert response.status_code == 200
    finally:
        test_app.dependency_overrides.pop(get_optional_session, None)


async def test_gated_stream_owner_redirects(
    test_app: FastAPI, gated_track: Track, owner_session: Session
):
    """regression: GET /audio/{file_id} returns 307 redirect for track owner."""
    from backend._internal import get_optional_session

    mock_storage = MagicMock()
    mock_storage.generate_presigned_url = AsyncMock(
        return_value="https://presigned.example.com/audio/gated.mp3"
    )

    test_app.dependency_overrides[get_optional_session] = lambda: owner_session

    try:
        with patch("backend.api.audio.storage", mock_storage):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/audio/{gated_track.file_id}", follow_redirects=False
                )

        assert response.status_code == 307
        assert "presigned.example.com" in response.headers["location"]
        mock_storage.generate_presigned_url.assert_called_once()
    finally:
        test_app.dependency_overrides.pop(get_optional_session, None)


async def test_gated_head_non_supporter_denied(
    test_app: FastAPI, gated_track: Track, non_supporter_session: Session
):
    """regression: HEAD /audio/{file_id} returns 402 for non-supporter."""
    from backend._internal import get_optional_session

    test_app.dependency_overrides[get_optional_session] = lambda: non_supporter_session

    # mock validate_supporter to return invalid
    mock_validation = MagicMock()
    mock_validation.valid = False

    try:
        with patch(
            "backend.api.audio.validate_supporter",
            AsyncMock(return_value=mock_validation),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.head(f"/audio/{gated_track.file_id}")

        assert response.status_code == 402
        assert response.headers.get("x-support-required") == "true"
    finally:
        test_app.dependency_overrides.pop(get_optional_session, None)


async def test_gated_stream_non_supporter_denied(
    test_app: FastAPI, gated_track: Track, non_supporter_session: Session
):
    """regression: GET /audio/{file_id} returns 402 for non-supporter."""
    from backend._internal import get_optional_session

    test_app.dependency_overrides[get_optional_session] = lambda: non_supporter_session

    # mock validate_supporter to return invalid
    mock_validation = MagicMock()
    mock_validation.valid = False

    try:
        with patch(
            "backend.api.audio.validate_supporter",
            AsyncMock(return_value=mock_validation),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/audio/{gated_track.file_id}", follow_redirects=False
                )

        assert response.status_code == 402
        assert "supporter access" in response.json()["detail"]
    finally:
        test_app.dependency_overrides.pop(get_optional_session, None)


# lossless/original file serving tests


@pytest.fixture
async def test_track_with_original(db_session: AsyncSession) -> Track:
    """create a track with both transcoded and original lossless file."""
    artist = Artist(
        did="did:plc:losslessartist",
        handle="losslessartist.bsky.social",
        display_name="Lossless Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Lossless Track",
        artist_did=artist.did,
        file_id="transcoded123",  # MP3 version
        file_type="mp3",
        original_file_id="original456",  # AIFF original
        original_file_type="aiff",
        r2_url="https://cdn.example.com/audio/transcoded123.mp3",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


async def test_stream_audio_by_original_file_id(
    test_app: FastAPI, test_track_with_original: Track
):
    """regression: requesting by original_file_id serves the lossless original."""
    expected_url = "https://cdn.example.com/audio/original456.aiff"

    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=expected_url)

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_with_original.original_file_id}",
                follow_redirects=False,
            )

    assert response.status_code == 307
    assert response.headers["location"] == expected_url
    mock_storage.get_url.assert_called_once_with(
        test_track_with_original.original_file_id,
        file_type="audio",
        extension=test_track_with_original.original_file_type,
    )


async def test_stream_audio_by_file_id_uses_cached_r2_url(
    test_app: FastAPI, test_track_with_original: Track
):
    """requesting by file_id (transcoded) uses cached r2_url."""
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock()

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_with_original.file_id}", follow_redirects=False
            )

    assert response.status_code == 307
    assert response.headers["location"] == test_track_with_original.r2_url
    mock_storage.get_url.assert_not_called()


async def test_get_audio_url_by_original_file_id(
    test_app: FastAPI, test_track_with_original: Track, mock_session: Session
):
    """/url endpoint with original_file_id returns lossless URL."""
    expected_url = "https://cdn.example.com/audio/original456.aiff"

    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=expected_url)

    test_app.dependency_overrides[require_auth] = lambda: mock_session

    try:
        with patch("backend.api.audio.storage", mock_storage):
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/audio/{test_track_with_original.original_file_id}/url"
                )

        assert response.status_code == 200
        data = response.json()
        assert data["url"] == expected_url
        assert data["file_id"] == test_track_with_original.original_file_id
        assert data["file_type"] == test_track_with_original.original_file_type
    finally:
        test_app.dependency_overrides.pop(require_auth, None)

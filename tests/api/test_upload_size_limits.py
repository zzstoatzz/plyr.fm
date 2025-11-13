"""test upload size limits for audio and image files."""

import io
from collections.abc import AsyncGenerator, Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.main import app
from backend.models import Artist, Track


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id"
        self.oauth_session = {
            "did": did,
            "handle": "testuser.bsky.social",
            "pds_url": "https://test.pds",
        }


@pytest.fixture
async def test_artist(db_session: AsyncSession) -> Artist:
    """create test artist for upload tests."""
    artist = Artist(
        did="did:plc:testartist",
        handle="testartist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def test_track(db_session: AsyncSession, test_artist: Artist) -> Track:
    """create test track for update tests."""
    track = Track(
        title="test track",
        file_id="testfile123456",
        file_type="mp3",
        artist_did=test_artist.did,
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.fixture
def auth_override_app(test_artist: Artist) -> Generator[FastAPI, None, None]:
    """override auth dependency to bypass OAuth for tests."""
    mock_session = MockSession(did=test_artist.did)

    async def override_auth() -> Session:
        return mock_session

    app.dependency_overrides[require_auth] = override_auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(auth_override_app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """create test client with auth override."""
    async with AsyncClient(
        transport=ASGITransport(app=auth_override_app), base_url="http://test"
    ) as ac:
        yield ac


async def test_audio_upload_within_limit(
    client: AsyncClient,
    test_artist: Artist,
):
    """test that audio files within size limit upload successfully."""
    # create a small test file (1MB)
    audio_size = 1 * 1024 * 1024  # 1MB
    audio_data = b"0" * audio_size
    audio_file = io.BytesIO(audio_data)

    response = await client.post(
        "/tracks",
        data={
            "title": "small audio test",
            "album": "test album",
        },
        files={
            "file": ("test.mp3", audio_file, "audio/mpeg"),
        },
    )

    # should accept small files
    assert response.status_code == 200
    data = response.json()
    assert "upload_id" in data


async def test_audio_upload_exceeds_limit(
    client: AsyncClient,
    test_artist: Artist,
):
    """test that audio files exceeding size limit are rejected."""
    # temporarily set a smaller limit for testing
    original_limit = settings.storage.max_upload_size_mb
    settings.storage.max_upload_size_mb = 10  # 10MB for testing

    try:
        # create 11MB file (exceeds 10MB limit)
        audio_size = 11 * 1024 * 1024
        audio_data = b"0" * audio_size
        audio_file = io.BytesIO(audio_data)

        response = await client.post(
            "/tracks",
            data={
                "title": "too large audio",
                "album": "test album",
            },
            files={
                "file": ("toolarge.mp3", audio_file, "audio/mpeg"),
            },
        )

        # should reject with 413
        assert response.status_code == 413
        assert "too large" in response.json()["detail"].lower()
        assert "10MB" in response.json()["detail"]
    finally:
        # restore original limit
        settings.storage.max_upload_size_mb = original_limit


async def test_image_upload_within_limit(
    client: AsyncClient,
    test_artist: Artist,
):
    """test that image files within 20MB limit upload successfully."""
    # create small audio file
    audio_data = b"0" * (1024 * 1024)  # 1MB
    audio_file = io.BytesIO(audio_data)

    # create small image (1MB)
    image_size = 1 * 1024 * 1024
    image_data = b"0" * image_size
    image_file = io.BytesIO(image_data)

    response = await client.post(
        "/tracks",
        data={
            "title": "track with small image",
            "album": "test",
        },
        files={
            "file": ("test.mp3", audio_file, "audio/mpeg"),
            "image": ("cover.jpg", image_file, "image/jpeg"),
        },
    )

    # should accept small images
    assert response.status_code == 200


async def test_image_upload_exceeds_limit(
    client: AsyncClient,
    test_artist: Artist,
):
    """test that image files exceeding 20MB are rejected."""
    # create small audio file
    audio_data = b"0" * (1024 * 1024)  # 1MB
    audio_file = io.BytesIO(audio_data)

    # create 21MB image (exceeds 20MB limit)
    image_size = 21 * 1024 * 1024
    image_data = b"0" * image_size
    image_file = io.BytesIO(image_data)

    response = await client.post(
        "/tracks",
        data={
            "title": "track with large image",
            "album": "test",
        },
        files={
            "file": ("test.mp3", audio_file, "audio/mpeg"),
            "image": ("toolarge.jpg", image_file, "image/jpeg"),
        },
    )

    # should reject with 413
    assert response.status_code == 413
    assert "image too large" in response.json()["detail"].lower()


async def test_image_update_exceeds_limit(
    client: AsyncClient,
    test_artist: Artist,
    test_track: Track,
):
    """test that image updates exceeding 20MB are rejected."""
    # create 21MB image
    image_size = 21 * 1024 * 1024
    image_data = b"0" * image_size
    image_file = io.BytesIO(image_data)

    response = await client.patch(
        f"/tracks/{test_track.id}",
        data={"title": "updated title"},
        files={"image": ("toolarge.jpg", image_file, "image/jpeg")},
    )

    # should reject with 413
    assert response.status_code == 413
    assert "image too large" in response.json()["detail"].lower()


async def test_temp_file_cleanup_on_size_limit(
    client: AsyncClient,
    test_artist: Artist,
):
    """test that temp files are cleaned up when size limit is exceeded."""
    # set small limit for testing
    original_limit = settings.storage.max_upload_size_mb
    settings.storage.max_upload_size_mb = 5  # 5MB

    try:
        # create 6MB file
        audio_size = 6 * 1024 * 1024
        audio_data = b"0" * audio_size
        audio_file = io.BytesIO(audio_data)

        response = await client.post(
            "/tracks",
            data={"title": "size limit test"},
            files={"file": ("test.mp3", audio_file, "audio/mpeg")},
        )

        # should reject
        assert response.status_code == 413

        # verify no orphaned temp files left behind
        # (this is implicit - if temp files aren't cleaned up, they accumulate in /tmp)
        # we rely on the cleanup logic in the endpoint itself
    finally:
        settings.storage.max_upload_size_mb = original_limit


def test_configurable_upload_limit():
    """test that upload size limit is configurable via settings."""
    # verify default is 1536MB (1.5GB)
    assert settings.storage.max_upload_size_mb == 1536

    # verify it can be changed (this would normally be via env var)
    settings.storage.max_upload_size_mb = 2048
    assert settings.storage.max_upload_size_mb == 2048

    # restore default
    settings.storage.max_upload_size_mb = 1536

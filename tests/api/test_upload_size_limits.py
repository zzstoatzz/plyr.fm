"""test upload size limits for audio and image files."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models import Artist, Track


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


def test_configurable_upload_limit():
    """test that upload size limit is configurable via settings."""
    # verify default is 1536MB (1.5GB)
    assert settings.storage.max_upload_size_mb == 1536

    # verify it can be changed (this would normally be via env var)
    settings.storage.max_upload_size_mb = 2048
    assert settings.storage.max_upload_size_mb == 2048

    # restore default
    settings.storage.max_upload_size_mb = 1536

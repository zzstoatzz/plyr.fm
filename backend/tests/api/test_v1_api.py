"""tests for v1 public API and API key authentication."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.api_keys import generate_api_key, verify_api_key
from backend._internal.auth import AuthContext, require_auth_v1
from backend.main import app
from backend.models import APIKey, Artist, KeyEnvironment, KeyType, Track


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
            "scope": "atproto transition:generic repo:fm.plyr.track repo:fm.plyr.like",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
async def test_artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def test_track(db_session: AsyncSession, test_artist: Artist) -> Track:
    """create a test track with artist."""
    track = Track(
        title="Test Track",
        artist_did=test_artist.did,
        file_id="test123",
        file_type="mp3",
        extra={"duration_ms": 180000},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/test123",
        atproto_record_cid="bafytest123",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


# --------------------------------------------------------------------------
# API Key Generation and Verification Tests
# --------------------------------------------------------------------------


def test_generate_api_key_format():
    """test API key has correct format."""
    full_key, prefix, key_hash = generate_api_key()

    # verify format: plyr_{type}_{env}_{random}
    assert full_key.startswith("plyr_sk_live_")
    assert len(prefix) == 24
    assert prefix == full_key[:24]
    assert len(key_hash) > 0


def test_generate_api_key_different_environments():
    """test API key generation for different environments."""
    # live key
    live_key, _live_prefix, _ = generate_api_key(KeyType.SECRET, KeyEnvironment.LIVE)
    assert "sk_live" in live_key

    # test key
    test_key, _test_prefix, _ = generate_api_key(KeyType.SECRET, KeyEnvironment.TEST)
    assert "sk_test" in test_key

    # publishable key
    pub_key, _pub_prefix, _ = generate_api_key(KeyType.PUBLISHABLE, KeyEnvironment.LIVE)
    assert "pk_live" in pub_key


def test_verify_api_key_success():
    """test API key verification succeeds with correct key."""
    full_key, _prefix, key_hash = generate_api_key()

    assert verify_api_key(full_key, key_hash) is True


def test_verify_api_key_failure():
    """test API key verification fails with wrong key."""
    _full_key, _prefix, key_hash = generate_api_key()
    wrong_key = "plyr_sk_live_wrongkeyhere"

    assert verify_api_key(wrong_key, key_hash) is False


def test_api_keys_are_unique():
    """test that each generated key is unique."""
    keys = [generate_api_key()[0] for _ in range(10)]
    assert len(set(keys)) == 10


# --------------------------------------------------------------------------
# API Key Management Endpoints Tests
# --------------------------------------------------------------------------


async def test_create_api_key(test_app: FastAPI, db_session: AsyncSession):
    """test creating an API key."""
    # need artist with same DID as mock session
    artist = Artist(
        did="did:test:user123",
        handle="testuser.bsky.social",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/api-keys/",
            json={
                "name": "My Test Key",
                "key_type": "secret",
                "environment": "live",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "My Test Key"
    assert data["key_type"] == "secret"
    assert data["environment"] == "live"
    assert data["key"].startswith("plyr_sk_live_")
    assert len(data["key_prefix"]) == 24

    # verify key was stored in database
    result = await db_session.execute(
        select(APIKey).where(APIKey.key_prefix == data["key_prefix"])
    )
    api_key = result.scalar_one_or_none()
    assert api_key is not None
    assert api_key.name == "My Test Key"
    assert api_key.owner_did == "did:test:user123"


async def test_list_api_keys(test_app: FastAPI, db_session: AsyncSession):
    """test listing API keys."""
    # create artist with same DID as mock session
    artist = Artist(
        did="did:test:user123",
        handle="testuser.bsky.social",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.flush()

    # create some API keys
    _full_key1, prefix1, hash1 = generate_api_key()
    _full_key2, prefix2, hash2 = generate_api_key()

    key1 = APIKey(
        owner_did="did:test:user123",
        key_prefix=prefix1,
        key_hash=hash1,
        name="Key 1",
    )
    key2 = APIKey(
        owner_did="did:test:user123",
        key_prefix=prefix2,
        key_hash=hash2,
        name="Key 2",
    )
    db_session.add_all([key1, key2])
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/api-keys/")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    names = {k["name"] for k in data}
    assert names == {"Key 1", "Key 2"}

    # verify actual key values are NOT returned
    for key_info in data:
        assert "key" not in key_info or key_info.get("key") is None


async def test_revoke_api_key(test_app: FastAPI, db_session: AsyncSession):
    """test revoking an API key."""
    # create artist with same DID as mock session
    artist = Artist(
        did="did:test:user123",
        handle="testuser.bsky.social",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.flush()

    # create an API key
    _full_key, prefix, key_hash = generate_api_key()
    api_key = APIKey(
        owner_did="did:test:user123",
        key_prefix=prefix,
        key_hash=key_hash,
        name="Key to Revoke",
    )
    db_session.add(api_key)
    await db_session.commit()
    await db_session.refresh(api_key)

    key_id = str(api_key.id)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete(f"/v1/api-keys/{key_id}")

    assert response.status_code == 200
    assert response.json()["revoked"] is True

    # verify key is revoked in database
    await db_session.refresh(api_key)
    assert api_key.revoked_at is not None
    assert api_key.is_active is False


async def test_cannot_revoke_others_key(test_app: FastAPI, db_session: AsyncSession):
    """test that users cannot revoke other users' API keys."""
    # create artist with DIFFERENT DID than mock session
    artist = Artist(
        did="did:other:user456",
        handle="otheruser.bsky.social",
        display_name="Other User",
    )
    db_session.add(artist)
    await db_session.flush()

    # create an API key for other user
    _full_key, prefix, key_hash = generate_api_key()
    api_key = APIKey(
        owner_did="did:other:user456",
        key_prefix=prefix,
        key_hash=key_hash,
        name="Other's Key",
    )
    db_session.add(api_key)
    await db_session.commit()
    await db_session.refresh(api_key)

    key_id = str(api_key.id)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete(f"/v1/api-keys/{key_id}")

    assert response.status_code == 404


# --------------------------------------------------------------------------
# v1 Tracks Endpoint Tests
# --------------------------------------------------------------------------


async def test_list_tracks_public(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test listing tracks is public (no auth required)."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/tracks/")

    assert response.status_code == 200
    data = response.json()
    assert "tracks" in data
    assert len(data["tracks"]) >= 1
    assert data["tracks"][0]["title"] == "Test Track"


async def test_get_track_public(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test getting single track is public."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/v1/tracks/{test_track.id}")

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Test Track"
    assert data["artist"]["handle"] == "artist.bsky.social"


async def test_get_track_not_found(test_app: FastAPI, db_session: AsyncSession):
    """test getting non-existent track returns 404."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/tracks/99999")

    assert response.status_code == 404


async def test_list_my_tracks_requires_auth(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test listing own tracks requires authentication."""
    # clear overrides to test actual auth requirement
    test_app.dependency_overrides.clear()

    try:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/v1/tracks/me/tracks")

        assert response.status_code == 401
    finally:
        # restore mock auth for subsequent tests
        async def mock_require_auth() -> Session:
            return MockSession()

        test_app.dependency_overrides[require_auth] = mock_require_auth


async def test_list_my_tracks_with_session(test_app: FastAPI, db_session: AsyncSession):
    """test listing own tracks with session auth."""
    # create artist with same DID as mock session
    artist = Artist(
        did="did:test:user123",
        handle="testuser.bsky.social",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.flush()

    # create track for this artist
    track = Track(
        title="My Track",
        artist_did="did:test:user123",
        file_id="mytrack123",
        file_type="mp3",
        atproto_record_uri="at://did:test:user123/fm.plyr.track/mytrack123",
        atproto_record_cid="bafymy123",
    )
    db_session.add(track)
    await db_session.commit()

    # need to mock require_auth_v1 for this endpoint
    async def mock_require_auth_v1() -> AuthContext:
        return AuthContext(
            did="did:test:user123",
            handle="testuser.bsky.social",
            auth_type="session",
            session=MockSession(),
        )

    test_app.dependency_overrides[require_auth_v1] = mock_require_auth_v1

    try:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/v1/tracks/me/tracks")

        assert response.status_code == 200
        data = response.json()
        assert len(data["tracks"]) == 1
        assert data["tracks"][0]["title"] == "My Track"
    finally:
        del test_app.dependency_overrides[require_auth_v1]


async def test_list_my_tracks_with_api_key(test_app: FastAPI, db_session: AsyncSession):
    """test listing own tracks with API key auth."""
    # create artist
    artist = Artist(
        did="did:test:apiuser",
        handle="apiuser.bsky.social",
        display_name="API User",
    )
    db_session.add(artist)
    await db_session.flush()

    # create track for this artist
    track = Track(
        title="API User Track",
        artist_did="did:test:apiuser",
        file_id="apitrack123",
        file_type="mp3",
        atproto_record_uri="at://did:test:apiuser/fm.plyr.track/apitrack123",
        atproto_record_cid="bafyapi123",
    )
    db_session.add(track)
    await db_session.commit()

    # mock API key auth
    async def mock_require_auth_v1() -> AuthContext:
        return AuthContext(
            did="did:test:apiuser",
            handle=None,  # API key auth doesn't have handle
            auth_type="api_key",
        )

    test_app.dependency_overrides[require_auth_v1] = mock_require_auth_v1

    try:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/v1/tracks/me/tracks",
                headers={"Authorization": "Bearer plyr_sk_live_fakekeyhere"},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["tracks"]) == 1
        assert data["tracks"][0]["title"] == "API User Track"
    finally:
        del test_app.dependency_overrides[require_auth_v1]


async def test_tracks_pagination(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test tracks pagination works correctly."""
    # create multiple tracks
    for i in range(5):
        track = Track(
            title=f"Track {i}",
            artist_did=test_artist.did,
            file_id=f"track{i}",
            file_type="mp3",
            atproto_record_uri=f"at://did:plc:artist123/fm.plyr.track/track{i}",
            atproto_record_cid=f"bafy{i}",
        )
        db_session.add(track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # first page
        response = await client.get("/v1/tracks/?limit=2")
        assert response.status_code == 200
        data = response.json()
        assert len(data["tracks"]) == 2
        assert data["has_more"] is True
        assert data["cursor"] is not None

        # second page
        response = await client.get(f"/v1/tracks/?limit=2&cursor={data['cursor']}")
        assert response.status_code == 200
        data = response.json()
        assert len(data["tracks"]) == 2
        assert data["has_more"] is True


async def test_tracks_filter_by_artist(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist, test_track: Track
):
    """test filtering tracks by artist handle."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/v1/tracks/?artist=artist.bsky.social")

    assert response.status_code == 200
    data = response.json()
    assert len(data["tracks"]) == 1
    assert data["tracks"][0]["artist"]["handle"] == "artist.bsky.social"

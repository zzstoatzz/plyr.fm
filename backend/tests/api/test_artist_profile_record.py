"""tests for ATProto profile record integration with artist endpoints."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist


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


async def test_update_bio_creates_atproto_profile_record(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that updating bio triggers ATProto profile record upsert."""
    with patch(
        "backend.api.artists.upsert_profile_record",
        new_callable=AsyncMock,
        return_value=(
            "at://did:plc:testartist123/fm.plyr.actor.profile/self",
            "bafytest123",
        ),
    ) as mock_upsert:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/artists/me",
                json={"bio": "my new artist bio"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["bio"] == "my new artist bio"

    # verify ATProto record was created
    mock_upsert.assert_called_once()
    call_args = mock_upsert.call_args
    assert call_args.kwargs["bio"] == "my new artist bio"


async def test_update_bio_continues_on_atproto_failure(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that bio update succeeds even if ATProto call fails.

    database is source of truth, ATProto failure should not fail the request.
    """
    with patch(
        "backend.api.artists.upsert_profile_record",
        side_effect=Exception("PDS connection failed"),
    ) as mock_upsert:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/artists/me",
                json={"bio": "bio that should still save"},
            )

    # should still succeed despite ATProto failure
    assert response.status_code == 200
    data = response.json()
    assert data["bio"] == "bio that should still save"

    # verify ATProto was attempted
    mock_upsert.assert_called_once()


async def test_update_without_bio_skips_atproto(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that updating only display_name does not call ATProto."""
    with patch(
        "backend.api.artists.upsert_profile_record",
        new_callable=AsyncMock,
    ) as mock_upsert:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.put(
                "/artists/me",
                json={"display_name": "New Display Name"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["display_name"] == "New Display Name"

    # ATProto should NOT be called when bio is not updated
    mock_upsert.assert_not_called()


async def test_create_artist_with_bio_creates_atproto_record(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that creating artist with bio triggers ATProto profile record creation."""
    with patch(
        "backend.api.artists.upsert_profile_record",
        new_callable=AsyncMock,
        return_value=(
            "at://did:plc:testartist123/fm.plyr.actor.profile/self",
            "bafytest456",
        ),
    ) as mock_upsert:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/artists/",
                json={
                    "display_name": "New Artist",
                    "bio": "my initial bio",
                },
            )

    assert response.status_code == 200
    data = response.json()
    assert data["bio"] == "my initial bio"

    # verify ATProto record was created
    mock_upsert.assert_called_once()
    call_args = mock_upsert.call_args
    assert call_args.kwargs["bio"] == "my initial bio"


async def test_create_artist_without_bio_skips_atproto(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that creating artist without bio does not call ATProto."""
    with patch(
        "backend.api.artists.upsert_profile_record",
        new_callable=AsyncMock,
    ) as mock_upsert:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/artists/",
                json={"display_name": "Artist Without Bio"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["bio"] is None

    # ATProto should NOT be called when no bio provided
    mock_upsert.assert_not_called()

"""tests for album API helpers."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend.api.albums import list_artist_albums
from backend.main import app
from backend.models import Album, Artist, Track


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
    from backend._internal import require_artist_profile, require_auth

    async def mock_require_auth() -> Session:
        return MockSession()

    async def mock_require_artist_profile() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    app.dependency_overrides[require_artist_profile] = mock_require_artist_profile

    yield app

    app.dependency_overrides.clear()


async def test_list_artist_albums_groups_tracks(db_session: AsyncSession):
    """albums listing groups tracks per slug and aggregates counts."""
    artist = Artist(
        did="did:plc:testartist",
        handle="artist.test",
        display_name="Artist Test",
        bio=None,
        avatar_url="https://example.com/avatar.jpg",
    )
    db_session.add(artist)
    await db_session.commit()

    # create albums first
    album_a = Album(
        artist_did=artist.did,
        slug="album-a",
        title="Album A",
        image_url="https://example.com/a.jpg",
    )
    album_b = Album(
        artist_did=artist.did,
        slug="album-b",
        title="Album B",
        image_url="https://example.com/b.jpg",
    )
    db_session.add_all([album_a, album_b])
    await db_session.flush()

    # create tracks linked to albums
    album_tracks = [
        Track(
            title="Song A1",
            file_id="file-a1",
            file_type="mp3",
            artist_did=artist.did,
            album_id=album_a.id,
            extra={"album": "Album A"},
            play_count=5,
        ),
        Track(
            title="Song A2",
            file_id="file-a2",
            file_type="mp3",
            artist_did=artist.did,
            album_id=album_a.id,
            extra={"album": "Album A"},
            play_count=3,
        ),
        Track(
            title="Song B1",
            file_id="file-b1",
            file_type="mp3",
            artist_did=artist.did,
            album_id=album_b.id,
            extra={"album": "Album B"},
            play_count=2,
        ),
    ]

    db_session.add_all(album_tracks)
    await db_session.commit()

    response = await list_artist_albums(artist.handle, db_session)
    albums = response["albums"]

    assert len(albums) == 2
    first = next(album for album in albums if album.slug == "album-a")
    assert first.track_count == 2
    assert first.total_plays == 8
    assert first.image_url == "https://example.com/a.jpg"

    second = next(album for album in albums if album.slug == "album-b")
    assert second.track_count == 1
    assert second.total_plays == 2


async def test_get_album_serializes_tracks_correctly(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that get_album properly serializes tracks with album data."""
    # create artist
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album
    album = Album(
        artist_did=artist.did,
        slug="test-album",
        title="Test Album",
        image_url="https://example.com/album.jpg",
    )
    db_session.add(album)
    await db_session.flush()

    # create tracks linked to album
    track1 = Track(
        title="Track 1",
        file_id="test-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        play_count=5,
    )
    track2 = Track(
        title="Track 2",
        file_id="test-file-2",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        play_count=3,
    )
    db_session.add_all([track1, track2])
    await db_session.commit()

    # fetch album via API
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/albums/{artist.handle}/{album.slug}")

    assert response.status_code == 200
    data = response.json()

    # verify album metadata
    assert data["metadata"]["id"] == album.id
    assert data["metadata"]["title"] == "Test Album"
    assert data["metadata"]["slug"] == "test-album"
    assert data["metadata"]["artist"] == "Test Artist"
    assert data["metadata"]["artist_handle"] == "test.artist"
    assert data["metadata"]["track_count"] == 2
    assert data["metadata"]["total_plays"] == 8

    # verify tracks are properly serialized as dicts
    assert len(data["tracks"]) == 2
    assert isinstance(data["tracks"][0], dict)
    assert data["tracks"][0]["title"] == "Track 1"
    assert data["tracks"][0]["artist"] == "Test Artist"
    assert data["tracks"][0]["file_id"] == "test-file-1"
    assert data["tracks"][0]["play_count"] == 5

    # verify album data is included in tracks
    assert data["tracks"][0]["album"] is not None
    assert data["tracks"][0]["album"]["id"] == album.id
    assert data["tracks"][0]["album"]["slug"] == "test-album"
    assert data["tracks"][0]["album"]["title"] == "Test Album"


async def test_delete_album_orphans_tracks_by_default(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that deleting album orphans tracks (sets album_id to null).

    regression test for user report: unable to delete empty album after
    deleting individual tracks.
    """
    # create artist matching mock session
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album
    album = Album(
        artist_did=artist.did,
        slug="test-album",
        title="Test Album",
    )
    db_session.add(album)
    await db_session.flush()

    # create tracks linked to album
    track1 = Track(
        title="Track 1",
        file_id="test-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
    )
    track2 = Track(
        title="Track 2",
        file_id="test-file-2",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
    )
    db_session.add_all([track1, track2])
    await db_session.commit()

    album_id = album.id
    track1_id = track1.id
    track2_id = track2.id

    # mock ATProto delete (imported inside the function from _internal.atproto.records)
    with patch(
        "backend._internal.atproto.records.fm_plyr.track.delete_record_by_uri",
        new_callable=AsyncMock,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/albums/{album_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["deleted"] is True
    assert data["cascade"] is False

    # close test session and create fresh one to read committed data
    await db_session.close()

    # verify album is deleted by checking response
    # (the API committed in a separate session, test session can't see it)
    # Use a fresh query to verify the state
    from backend.utilities.database import get_engine

    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as fresh_session:
        # verify album is deleted
        result = await fresh_session.execute(select(Album).where(Album.id == album_id))
        assert result.scalar_one_or_none() is None

        # verify tracks still exist but are orphaned (album_id = null)
        result = await fresh_session.execute(select(Track).where(Track.id == track1_id))
        track1_after = result.scalar_one_or_none()
        assert track1_after is not None
        assert track1_after.album_id is None

        result = await fresh_session.execute(select(Track).where(Track.id == track2_id))
        track2_after = result.scalar_one_or_none()
        assert track2_after is not None
        assert track2_after.album_id is None


async def test_delete_album_cascade_deletes_tracks(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that deleting album with cascade=true also deletes all tracks."""
    # create artist matching mock session
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album
    album = Album(
        artist_did=artist.did,
        slug="test-album-cascade",
        title="Test Album Cascade",
    )
    db_session.add(album)
    await db_session.flush()

    # create tracks linked to album
    track1 = Track(
        title="Track 1",
        file_id="cascade-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
    )
    track2 = Track(
        title="Track 2",
        file_id="cascade-file-2",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
    )
    db_session.add_all([track1, track2])
    await db_session.commit()

    album_id = album.id
    track1_id = track1.id
    track2_id = track2.id

    # mock ATProto and storage deletes
    with (
        patch(
            "backend._internal.atproto.records.fm_plyr.track.delete_record_by_uri",
            new_callable=AsyncMock,
        ),
        patch(
            "backend.api.tracks.mutations.delete_record_by_uri",
            new_callable=AsyncMock,
        ),
        patch(
            "backend.api.tracks.mutations.storage.delete",
            new_callable=AsyncMock,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/albums/{album_id}?cascade=true")

    assert response.status_code == 200
    data = response.json()
    assert data["deleted"] is True
    assert data["cascade"] is True

    # verify album is deleted
    result = await db_session.execute(select(Album).where(Album.id == album_id))
    assert result.scalar_one_or_none() is None

    # verify tracks are also deleted
    result = await db_session.execute(select(Track).where(Track.id == track1_id))
    assert result.scalar_one_or_none() is None

    result = await db_session.execute(select(Track).where(Track.id == track2_id))
    assert result.scalar_one_or_none() is None


async def test_delete_album_forbidden_for_non_owner(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that users cannot delete albums they don't own."""
    # create a different artist (not the mock session's did)
    other_artist = Artist(
        did="did:other:artist999",
        handle="other.artist",
        display_name="Other Artist",
    )
    db_session.add(other_artist)
    await db_session.flush()

    # create album owned by other artist
    album = Album(
        artist_did=other_artist.did,
        slug="other-album",
        title="Other Album",
    )
    db_session.add(album)
    await db_session.commit()

    album_id = album.id

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete(f"/albums/{album_id}")

    assert response.status_code == 403
    assert "your own albums" in response.json()["detail"]


async def test_delete_empty_album(test_app: FastAPI, db_session: AsyncSession):
    """test deleting an album with no tracks (empty album shell).

    regression test for user report: after deleting all tracks individually,
    the album folder remains and cannot be deleted.
    """
    # create artist matching mock session
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create empty album (no tracks)
    album = Album(
        artist_did=artist.did,
        slug="empty-album",
        title="Empty Album",
    )
    db_session.add(album)
    await db_session.commit()

    album_id = album.id

    # mock ATProto delete
    with patch(
        "backend._internal.atproto.records.fm_plyr.track.delete_record_by_uri",
        new_callable=AsyncMock,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/albums/{album_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["deleted"] is True

    # verify album is deleted
    result = await db_session.execute(select(Album).where(Album.id == album_id))
    assert result.scalar_one_or_none() is None


async def test_get_album_respects_atproto_track_order(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that get_album returns tracks in ATProto list order.

    regression test for user report: album track reorder doesn't persist.
    the frontend saves order to ATProto, but backend was ignoring it.
    """
    from datetime import UTC, datetime, timedelta

    # create artist
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album with ATProto record URI
    album = Album(
        artist_did=artist.did,
        slug="ordered-album",
        title="Ordered Album",
        atproto_record_uri="at://did:test:user123/fm.plyr.list/album123",
    )
    db_session.add(album)
    await db_session.flush()

    # create tracks with staggered created_at (track3 first, track1 last)
    base_time = datetime.now(UTC)
    track1 = Track(
        title="Track 1",
        file_id="order-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/track1",
        atproto_record_cid="cid1",
        created_at=base_time + timedelta(hours=2),  # created last
    )
    track2 = Track(
        title="Track 2",
        file_id="order-file-2",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/track2",
        atproto_record_cid="cid2",
        created_at=base_time + timedelta(hours=1),  # created second
    )
    track3 = Track(
        title="Track 3",
        file_id="order-file-3",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/track3",
        atproto_record_cid="cid3",
        created_at=base_time,  # created first
    )
    db_session.add_all([track1, track2, track3])
    await db_session.commit()

    # mock ATProto record fetch to return custom order: track2, track3, track1
    # (different from created_at order which would be track3, track2, track1)
    mock_record = {
        "value": {
            "items": [
                {"subject": {"uri": track2.atproto_record_uri, "cid": "cid2"}},
                {"subject": {"uri": track3.atproto_record_uri, "cid": "cid3"}},
                {"subject": {"uri": track1.atproto_record_uri, "cid": "cid1"}},
            ]
        }
    }

    with patch(
        "backend._internal.atproto.records.get_record_public",
        new_callable=AsyncMock,
        return_value=mock_record,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/albums/{artist.handle}/{album.slug}")

    assert response.status_code == 200
    data = response.json()

    # verify tracks are in ATProto order (track2, track3, track1)
    # NOT created_at order (which would be track3, track2, track1)
    assert len(data["tracks"]) == 3
    assert data["tracks"][0]["title"] == "Track 2"
    assert data["tracks"][1]["title"] == "Track 3"
    assert data["tracks"][2]["title"] == "Track 1"


async def test_get_album_fallback_to_created_at_without_atproto(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that get_album falls back to created_at order without ATProto record."""
    from datetime import UTC, datetime, timedelta

    # create artist
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album WITHOUT ATProto record URI
    album = Album(
        artist_did=artist.did,
        slug="no-atproto-album",
        title="No ATProto Album",
        atproto_record_uri=None,  # no ATProto record
    )
    db_session.add(album)
    await db_session.flush()

    # create tracks with specific order
    base_time = datetime.now(UTC)
    track1 = Track(
        title="First Track",
        file_id="first-file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        created_at=base_time,
    )
    track2 = Track(
        title="Second Track",
        file_id="second-file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        created_at=base_time + timedelta(hours=1),
    )
    track3 = Track(
        title="Third Track",
        file_id="third-file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        created_at=base_time + timedelta(hours=2),
    )
    db_session.add_all([track1, track2, track3])
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/albums/{artist.handle}/{album.slug}")

    assert response.status_code == 200
    data = response.json()

    # verify tracks are in created_at order (default fallback)
    assert len(data["tracks"]) == 3
    assert data["tracks"][0]["title"] == "First Track"
    assert data["tracks"][1]["title"] == "Second Track"
    assert data["tracks"][2]["title"] == "Third Track"

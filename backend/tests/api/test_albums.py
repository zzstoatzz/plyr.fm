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

    # mock ATProto list fetch to return custom order: track2, track3, track1
    # (different from created_at order which would be track3, track2, track1)
    mock_uris = [
        track2.atproto_record_uri,
        track3.atproto_record_uri,
        track1.atproto_record_uri,
    ]

    with patch(
        "backend.api.albums.listing.fetch_list_item_uris",
        new_callable=AsyncMock,
        return_value=mock_uris,
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


async def test_update_album_title(test_app: FastAPI, db_session: AsyncSession):
    """test updating album title via PATCH endpoint.

    verifies that:
    1. album title is updated in database
    2. track extra["album"] is updated for all tracks
    3. ATProto records are updated for tracks that have them
    4. album's ATProto list record name is updated
    """
    # create artist matching mock session
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album with ATProto list record
    album = Album(
        artist_did=artist.did,
        slug="test-album",
        title="Original Title",
        atproto_record_uri="at://did:test:user123/fm.plyr.dev.list/album123",
        atproto_record_cid="original_list_cid",
    )
    db_session.add(album)
    await db_session.flush()

    # create track with ATProto record
    track = Track(
        title="Test Track",
        file_id="test-file-update",
        file_type="mp3",
        artist_did=artist.did,
        album_id=album.id,
        extra={"album": "Original Title"},
        r2_url="https://r2.example.com/audio/test-file-update.mp3",
        atproto_record_uri="at://did:test:user123/fm.plyr.track/track123",
        atproto_record_cid="original_cid",
    )
    db_session.add(track)
    await db_session.commit()

    album_id = album.id
    track_id = track.id

    # mock ATProto update_record for tracks and list
    with (
        patch(
            "backend.api.albums.mutations.update_record",
            new_callable=AsyncMock,
            return_value=("at://did:test:user123/fm.plyr.track/track123", "new_cid"),
        ) as mock_track_update,
        patch(
            "backend.api.albums.mutations.update_list_record",
            new_callable=AsyncMock,
            return_value=(
                "at://did:test:user123/fm.plyr.dev.list/album123",
                "new_list_cid",
            ),
        ) as mock_list_update,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.patch(f"/albums/{album_id}?title=Updated%20Title")

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Updated Title"
    assert data["id"] == album_id

    # verify track ATProto update was called
    mock_track_update.assert_called_once()
    call_kwargs = mock_track_update.call_args.kwargs
    assert call_kwargs["record"]["album"] == "Updated Title"

    # verify list record update was called with new name
    mock_list_update.assert_called_once()
    list_call_kwargs = mock_list_update.call_args.kwargs
    assert list_call_kwargs["name"] == "Updated Title"
    assert list_call_kwargs["list_type"] == "album"

    # verify track extra["album"] was updated in database
    from backend.utilities.database import get_engine

    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as fresh_session:
        result = await fresh_session.execute(select(Track).where(Track.id == track_id))
        updated_track = result.scalar_one()
        assert updated_track.extra["album"] == "Updated Title"
        assert updated_track.atproto_record_cid == "new_cid"

        # verify album list record CID was updated
        album_result = await fresh_session.execute(
            select(Album).where(Album.id == album_id)
        )
        updated_album = album_result.scalar_one()
        assert updated_album.atproto_record_cid == "new_list_cid"


async def test_update_album_forbidden_for_non_owner(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that users cannot update albums they don't own."""
    # create a different artist
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
        response = await client.patch(f"/albums/{album_id}?title=Hacked%20Title")

    assert response.status_code == 403
    assert "your own albums" in response.json()["detail"]


async def test_update_album_syncs_slug_on_title_change(
    test_app: FastAPI, db_session: AsyncSession
):
    """regression test: album slug must update when title changes.

    fixes bug where renaming an album via PATCH didn't update the slug,
    causing get_or_create_album to create duplicates when adding tracks
    to the renamed album (since it looks up by slugified title).
    """
    from backend.utilities.slugs import slugify

    # create artist matching mock session
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album with original title/slug
    original_title = "Private Event 2016"
    album = Album(
        artist_did=artist.did,
        slug=slugify(original_title),
        title=original_title,
    )
    db_session.add(album)
    await db_session.commit()

    album_id = album.id
    assert album.slug == "private-event-2016"

    # rename album with PATCH
    new_title = "The Waybacks at Private Event 2016"
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/albums/{album_id}?title={new_title.replace(' ', '%20')}"
        )

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == new_title
    # slug should be updated to match new title
    assert data["slug"] == slugify(new_title)
    assert data["slug"] == "the-waybacks-at-private-event-2016"

    # verify in database
    from backend.utilities.database import get_engine

    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as fresh_session:
        result = await fresh_session.execute(select(Album).where(Album.id == album_id))
        updated_album = result.scalar_one()
        assert updated_album.title == new_title
        assert updated_album.slug == "the-waybacks-at-private-event-2016"


async def test_remove_track_from_album(test_app: FastAPI, db_session: AsyncSession):
    """test removing a track from an album (orphaning it)."""
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

    # create track in album
    track = Track(
        title="Track to Remove",
        file_id="remove-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
    )
    db_session.add(track)
    await db_session.commit()

    album_id = album.id
    track_id = track.id

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete(f"/albums/{album_id}/tracks/{track_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["removed"] is True
    assert data["track_id"] == track_id

    # verify track is orphaned (album_id = null)
    from backend.utilities.database import get_engine

    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as fresh_session:
        result = await fresh_session.execute(select(Track).where(Track.id == track_id))
        track_after = result.scalar_one_or_none()
        assert track_after is not None
        assert track_after.album_id is None


async def test_remove_track_not_in_album(test_app: FastAPI, db_session: AsyncSession):
    """test that removing a track not in the album returns 400."""
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
    )
    db_session.add(album)
    await db_session.flush()

    # create track NOT in this album (orphaned)
    track = Track(
        title="Orphan Track",
        file_id="orphan-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=None,  # not in any album
    )
    db_session.add(track)
    await db_session.commit()

    album_id = album.id
    track_id = track.id

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete(f"/albums/{album_id}/tracks/{track_id}")

    assert response.status_code == 400
    assert "not in this album" in response.json()["detail"]


# -----------------------------------------------------------------------------
# POST /albums/ and POST /albums/{id}/finalize
# -----------------------------------------------------------------------------


async def test_create_album_endpoint(test_app: FastAPI, db_session: AsyncSession):
    """POST /albums/ creates an empty album shell without tracks or list record."""
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/albums/",
            json={"title": "My New Album", "description": "some notes"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "My New Album"
    assert data["slug"] == "my-new-album"
    assert data["description"] == "some notes"
    assert data["track_count"] == 0
    assert data["list_uri"] is None  # no PDS list record yet

    # verify it landed in the DB
    result = await db_session.execute(select(Album).where(Album.slug == "my-new-album"))
    album = result.scalar_one()
    assert album.artist_did == artist.did
    assert album.atproto_record_uri is None


async def test_create_album_idempotent_on_duplicate_slug(
    test_app: FastAPI, db_session: AsyncSession
):
    """POST /albums/ with a duplicate title returns the existing row."""
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    existing = Album(
        artist_did=artist.did,
        slug="my-album",
        title="My Album",
    )
    db_session.add(existing)
    await db_session.commit()
    existing_id = existing.id

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/albums/", json={"title": "My Album"})

    assert response.status_code == 200
    assert response.json()["id"] == existing_id


async def test_finalize_album_writes_list_in_requested_order(
    test_app: FastAPI, db_session: AsyncSession
):
    """finalize uses the track_ids array order, ignoring created_at.

    regression test for concurrent-album-upload ordering: the frontend posts
    track_ids in user-intended order; the backend must build the ATProto
    list record using that exact ordering, not Track.created_at (which is
    racy under concurrent inserts).
    """
    from datetime import UTC, datetime, timedelta

    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    album = Album(
        artist_did=artist.did,
        slug="finalize-test",
        title="Finalize Test",
    )
    db_session.add(album)
    await db_session.flush()

    # intentionally stagger created_at to differ from user-intended order.
    # user-intended order (as passed to finalize): [t_a, t_b, t_c]
    # created_at order (if we were dumb): [t_c, t_b, t_a]
    base = datetime.now(UTC)
    t_a = Track(
        title="First by user intent",
        file_id="fin-a",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/aaa",
        atproto_record_cid="cidA",
        created_at=base + timedelta(hours=2),
    )
    t_b = Track(
        title="Second",
        file_id="fin-b",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/bbb",
        atproto_record_cid="cidB",
        created_at=base + timedelta(hours=1),
    )
    t_c = Track(
        title="Third",
        file_id="fin-c",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/ccc",
        atproto_record_cid="cidC",
        created_at=base,
    )
    db_session.add_all([t_a, t_b, t_c])
    await db_session.commit()

    album_id = album.id
    ordered_ids = [t_a.id, t_b.id, t_c.id]

    captured: dict[str, object] = {}

    async def fake_upsert(
        auth_session: object,
        *,
        album_id: str,
        album_title: str,
        track_refs: list[dict[str, str]],
        existing_uri: str | None = None,
        existing_created_at: object = None,
    ) -> tuple[str, str]:
        captured["track_refs"] = track_refs
        return (
            f"at://did:test:user123/fm.plyr.list/{album_id}",
            "new-list-cid",
        )

    with patch(
        "backend.api.albums.mutations.upsert_album_list_record",
        side_effect=fake_upsert,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/albums/{album_id}/finalize",
                json={"track_ids": ordered_ids},
            )

    assert response.status_code == 200, response.json()
    data = response.json()
    assert data["list_uri"] == f"at://did:test:user123/fm.plyr.list/{album_id}"

    # the strongRefs passed to upsert_album_list_record must be in the exact
    # order requested (t_a → t_b → t_c), NOT the created_at order
    track_refs = captured["track_refs"]
    assert isinstance(track_refs, list)
    uris: list[str] = [ref["uri"] for ref in track_refs]  # type: ignore[index]
    assert uris == [
        "at://did:test:user123/fm.plyr.track/aaa",
        "at://did:test:user123/fm.plyr.track/bbb",
        "at://did:test:user123/fm.plyr.track/ccc",
    ]


async def test_finalize_album_rejects_foreign_tracks(
    test_app: FastAPI, db_session: AsyncSession
):
    """finalize 400s if a track_id doesn't belong to the album."""
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    album = Album(artist_did=artist.did, slug="album-a", title="Album A")
    other_album = Album(artist_did=artist.did, slug="album-b", title="Album B")
    db_session.add_all([album, other_album])
    await db_session.flush()

    foreign_track = Track(
        title="Foreign",
        file_id="foreign-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=other_album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/foreign",
        atproto_record_cid="cidF",
    )
    db_session.add(foreign_track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/albums/{album.id}/finalize",
            json={"track_ids": [foreign_track.id]},
        )

    assert response.status_code == 400
    assert "do not belong" in response.json()["detail"]


async def test_finalize_album_rejects_tracks_missing_pds_record(
    test_app: FastAPI, db_session: AsyncSession
):
    """finalize 400s if a track hasn't completed its PDS write yet."""
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    album = Album(artist_did=artist.did, slug="pending-album", title="Pending")
    db_session.add(album)
    await db_session.flush()

    pending_track = Track(
        title="Still pending",
        file_id="pending-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri=None,  # not yet published
        atproto_record_cid=None,
    )
    db_session.add(pending_track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/albums/{album.id}/finalize",
            json={"track_ids": [pending_track.id]},
        )

    assert response.status_code == 400
    assert "PDS record" in response.json()["detail"]


# -----------------------------------------------------------------------------
# regression tests for review feedback on #1260:
#   P1: create_album used to emit album_release immediately, so a total upload
#       failure left a visible fake release in the activity feed.
#   P1: finalize_album used to send only the current-session tracks to the list
#       record, truncating prior tracks when appending to an existing album.
# -----------------------------------------------------------------------------


async def test_create_album_does_not_emit_release_event(
    test_app: FastAPI, db_session: AsyncSession
):
    """create_album must NOT emit album_release — that's deferred to finalize
    so total upload failures don't publish a fake release."""
    from backend.models import CollectionEvent

    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/albums/", json={"title": "Unreleased Album"})
    assert response.status_code == 200

    # verify no album_release event was emitted
    events_result = await db_session.execute(
        select(CollectionEvent).where(CollectionEvent.event_type == "album_release")
    )
    events = events_result.scalars().all()
    assert len(events) == 0, "create_album should not emit album_release"


async def test_finalize_album_emits_release_event_first_time_only(
    test_app: FastAPI, db_session: AsyncSession
):
    """finalize_album emits album_release on the first successful call, and
    never re-emits on subsequent finalize calls for the same album."""
    from backend.models import CollectionEvent

    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    album = Album(
        artist_did=artist.did,
        slug="first-time",
        title="First Time",
    )
    db_session.add(album)
    await db_session.flush()

    track = Track(
        title="Only Track",
        file_id="only-file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/only",
        atproto_record_cid="cidOnly",
    )
    db_session.add(track)
    await db_session.commit()
    album_id = album.id
    track_id = track.id

    async def fake_upsert(
        auth_session: object,
        *,
        album_id: str,
        album_title: str,
        track_refs: list[dict[str, str]],
        existing_uri: str | None = None,
        existing_created_at: object = None,
    ) -> tuple[str, str]:
        return (f"at://did:test:user123/fm.plyr.list/{album_id}", "cid-finalize")

    with patch(
        "backend.api.albums.mutations.upsert_album_list_record",
        side_effect=fake_upsert,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            # first finalize → emit event
            r1 = await client.post(
                f"/albums/{album_id}/finalize", json={"track_ids": [track_id]}
            )
            assert r1.status_code == 200

            # second finalize → must NOT emit again
            r2 = await client.post(
                f"/albums/{album_id}/finalize", json={"track_ids": [track_id]}
            )
            assert r2.status_code == 200

    await db_session.commit()

    events_result = await db_session.execute(
        select(CollectionEvent).where(
            CollectionEvent.album_id == album_id,
            CollectionEvent.event_type == "album_release",
        )
    )
    events = events_result.scalars().all()
    assert len(events) == 1, f"expected exactly one album_release, got {len(events)}"


async def test_list_albums_hides_empty_albums(
    test_app: FastAPI, db_session: AsyncSession
):
    """GET /albums/ must not include albums with zero tracks (drafts or
    abandoned uploads)."""
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    populated = Album(artist_did=artist.did, slug="populated", title="Populated Album")
    empty = Album(artist_did=artist.did, slug="empty", title="Empty Draft")
    db_session.add_all([populated, empty])
    await db_session.flush()

    track = Track(
        title="Only Track",
        file_id="pop-file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=populated.id,
    )
    db_session.add(track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/albums/")

    assert response.status_code == 200
    titles = [a["title"] for a in response.json()["albums"]]
    assert "Populated Album" in titles
    assert "Empty Draft" not in titles


async def test_list_artist_albums_hides_empty_albums(
    test_app: FastAPI, db_session: AsyncSession
):
    """GET /albums/{handle} must not include empty albums either — artist
    profile pages must not render fake releases."""
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    populated = Album(artist_did=artist.did, slug="real-album", title="Real Album")
    empty = Album(artist_did=artist.did, slug="ghost", title="Ghost")
    db_session.add_all([populated, empty])
    await db_session.flush()

    track = Track(
        title="Only Track",
        file_id="real-file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=populated.id,
    )
    db_session.add(track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/albums/{artist.handle}")

    assert response.status_code == 200
    titles = [a["title"] for a in response.json()["albums"]]
    assert "Real Album" in titles
    assert "Ghost" not in titles


async def test_finalize_album_preserves_existing_tracks_on_append(
    test_app: FastAPI, db_session: AsyncSession
):
    """when finalize is called with only a subset of the album's tracks (e.g.
    appending new tracks to an existing album), tracks already on the album
    that are NOT in track_ids must be preserved in the written list record.

    this is the P1 fix for the "list record truncation on append" review
    finding: without this, uploading additional tracks to an existing album
    would drop the older tracks from the PDS list record.
    """
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.flush()

    # pre-existing album with a list record and 2 existing tracks
    album = Album(
        artist_did=artist.did,
        slug="established",
        title="Established",
        atproto_record_uri="at://did:test:user123/fm.plyr.list/established",
        atproto_record_cid="cid-prev",
    )
    db_session.add(album)
    await db_session.flush()

    old1 = Track(
        title="Old Track 1",
        file_id="old-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/old1",
        atproto_record_cid="cidOld1",
    )
    old2 = Track(
        title="Old Track 2",
        file_id="old-2",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/old2",
        atproto_record_cid="cidOld2",
    )
    new1 = Track(
        title="New Track 1",
        file_id="new-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        atproto_record_uri="at://did:test:user123/fm.plyr.track/new1",
        atproto_record_cid="cidNew1",
    )
    db_session.add_all([old1, old2, new1])
    await db_session.commit()
    album_id = album.id
    new1_id = new1.id

    # simulate the current list record having old1, old2 in that order
    existing_uris = [old1.atproto_record_uri, old2.atproto_record_uri]

    captured: dict[str, object] = {}

    async def fake_upsert(
        auth_session: object,
        *,
        album_id: str,
        album_title: str,
        track_refs: list[dict[str, str]],
        existing_uri: str | None = None,
        existing_created_at: object = None,
    ) -> tuple[str, str]:
        captured["track_refs"] = track_refs
        return (existing_uri or "at://test/list/1", "cid-new")

    with (
        patch(
            "backend.api.albums.mutations.fetch_list_item_uris",
            new_callable=AsyncMock,
            return_value=existing_uris,
        ),
        patch(
            "backend.api.albums.mutations.upsert_album_list_record",
            side_effect=fake_upsert,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            # finalize with ONLY the new track — old tracks must be preserved
            response = await client.post(
                f"/albums/{album_id}/finalize",
                json={"track_ids": [new1_id]},
            )

    assert response.status_code == 200, response.json()
    track_refs = captured["track_refs"]
    assert isinstance(track_refs, list)
    uris: list[str] = [ref["uri"] for ref in track_refs]  # type: ignore[index]
    # the final list MUST contain all three tracks in order:
    # preserved (old1, old2 from existing list record) → new (new1)
    assert uris == [
        "at://did:test:user123/fm.plyr.track/old1",
        "at://did:test:user123/fm.plyr.track/old2",
        "at://did:test:user123/fm.plyr.track/new1",
    ], f"append-to-existing-album must preserve prior tracks, got {uris}"

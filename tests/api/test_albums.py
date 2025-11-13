"""tests for album API helpers."""

import pytest

from backend.api.albums import list_artist_albums
from backend.models import Artist, Track


@pytest.mark.asyncio
async def test_list_artist_albums_groups_tracks(db_session):
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

    album_tracks = [
        Track(
            title="Song A1",
            file_id="file-a1",
            file_type="mp3",
            artist_did=artist.did,
            extra={"album": "Album A"},
            album_slug="album-a",
            play_count=5,
            image_url="https://example.com/a.jpg",
        ),
        Track(
            title="Song A2",
            file_id="file-a2",
            file_type="mp3",
            artist_did=artist.did,
            extra={"album": "Album A"},
            album_slug="album-a",
            play_count=3,
            image_url="https://example.com/a.jpg",
        ),
        Track(
            title="Song B1",
            file_id="file-b1",
            file_type="mp3",
            artist_did=artist.did,
            extra={"album": "Album B"},
            album_slug="album-b",
            play_count=2,
            image_url="https://example.com/b.jpg",
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

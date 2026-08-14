"""tests for the album download endpoint."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Album, Artist, Track, UserPreferences


@pytest.fixture
def test_app() -> FastAPI:
    return app


async def _make_album(
    db_session: AsyncSession,
    *,
    n_tracks: int = 2,
    track_overrides: dict | None = None,
) -> tuple[Album, list[Track]]:
    artist = Artist(
        did="did:plc:albumartist",
        handle="albumartist.bsky.social",
        display_name="Album Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    album = Album(
        artist_did=artist.did,
        slug="test-album",
        title="Test Album",
    )
    db_session.add(album)
    await db_session.flush()

    tracks = []
    for i in range(n_tracks):
        fields = {
            "title": f"Song {i + 1}",
            "artist_did": artist.did,
            "album_id": album.id,
            "file_id": f"aabbccddeeff{i:04x}",
            "file_type": "mp3",
        } | (track_overrides or {})
        track = Track(**fields)
        db_session.add(track)
        tracks.append(track)
    await db_session.commit()
    for t in tracks:
        await db_session.refresh(t)
    return album, tracks


async def _download(test_app: FastAPI, handle: str = "albumartist.bsky.social"):
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        return await client.get(
            f"/albums/{handle}/test-album/download", follow_redirects=False
        )


async def test_album_download_enqueues_build_when_uncached(
    test_app: FastAPI, db_session: AsyncSession
):
    await _make_album(db_session)

    mock_storage = MagicMock()
    mock_storage.object_exists = AsyncMock(return_value=False)
    with (
        patch("backend.api.albums.downloads.storage", mock_storage),
        patch(
            "backend.api.albums.downloads.schedule_album_download",
            new_callable=AsyncMock,
        ) as schedule,
    ):
        response = await _download(test_app)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "preparing"
    assert body["job_id"]
    schedule.assert_awaited_once()
    # ordered track ids travel to the worker; digest-keyed destination
    _, track_ids, r2_key, zip_filename = schedule.await_args.args
    assert len(track_ids) == 2
    assert r2_key.startswith("exports/albums/")
    assert zip_filename == "Album Artist - Test Album.zip"


async def test_album_download_redirects_when_cached(
    test_app: FastAPI, db_session: AsyncSession
):
    await _make_album(db_session)

    mock_storage = MagicMock()
    mock_storage.object_exists = AsyncMock(return_value=True)
    mock_storage.public_audio_bucket_url = "https://audio.example.com"
    with patch("backend.api.albums.downloads.storage", mock_storage):
        response = await _download(test_app)

    assert response.status_code == 307
    assert response.headers["location"].startswith(
        "https://audio.example.com/exports/albums/"
    )


async def test_album_download_refuses_if_any_track_gated(
    test_app: FastAPI, db_session: AsyncSession
):
    await _make_album(db_session, track_overrides={"support_gate": {"type": "any"}})
    response = await _download(test_app)
    assert response.status_code == 403


async def test_album_download_refuses_if_artist_opted_out(
    test_app: FastAPI, db_session: AsyncSession
):
    album, _ = await _make_album(db_session)
    db_session.add(UserPreferences(did=album.artist_did, download_policy="off"))
    await db_session.commit()

    response = await _download(test_app)
    assert response.status_code == 403


async def test_album_download_404_when_a_file_is_not_ours(
    test_app: FastAPI, db_session: AsyncSession
):
    # rkey-shaped file_id with no r2_url: nothing we can serve
    await _make_album(
        db_session, n_tracks=1, track_overrides={"file_id": "3jzfcijpj2z2a"}
    )
    response = await _download(test_app)
    assert response.status_code == 404


async def test_album_download_404_unknown_album(
    test_app: FastAPI, db_session: AsyncSession
):
    response = await _download(test_app, handle="nobody.bsky.social")
    assert response.status_code == 404

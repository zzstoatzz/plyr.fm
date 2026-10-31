"""Public metadata is usable without per-track PDS requests."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Album, Artist, Track


@pytest.mark.parametrize("surface", ["track", "albums", "artist", "album"])
@pytest.mark.parametrize("duration", [183, 0, None])
async def test_public_metadata_preserves_stored_fields(
    db_session: AsyncSession, duration: int | None, surface: str
) -> None:
    created_at = datetime.now(UTC) + timedelta(days=1)
    artist = Artist(
        did="did:plc:metadata",
        handle="metadata.test",
        display_name="Metadata",
        avatar_url="https://example.com/avatar.jpg",
    )
    db_session.add(artist)
    await db_session.flush()
    album = Album(
        artist_did=artist.did,
        slug=f"metadata-{surface}-{duration}",
        title="Metadata",
        image_url="https://example.com/cover.jpg",
        created_at=created_at,
    )
    db_session.add(album)
    await db_session.flush()
    track = Track(
        artist_did=artist.did,
        album_id=album.id,
        title="Track",
        file_id="metadata-audio",
        file_type="mp3",
        play_count=7,
        extra={"duration": duration} if duration is not None else {},
    )
    db_session.add(track)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        if surface == "track":
            response = await client.get(f"/tracks/{track.id}")
            assert response.status_code == 200
            assert response.json()["duration"] == duration
        elif surface in {"albums", "artist"}:
            path = "/albums/" if surface == "albums" else f"/albums/{artist.handle}"
            response = await client.get(path)
            assert response.status_code == 200
            item = next(a for a in response.json()["albums"] if a["id"] == album.id)
            assert item["image_url"] == album.image_url
            assert item["total_plays"] == 7
            assert datetime.fromisoformat(item["created_at"]) == created_at
        else:
            for _ in range(2):
                response = await client.get(f"/albums/{artist.handle}/{album.slug}")
                assert response.status_code == 200
                data = response.json()
                assert (
                    datetime.fromisoformat(data["metadata"]["created_at"]) == created_at
                )
                assert data["tracks"][0]["duration"] == duration

"""Owner-selected external album playback stays opt-in."""

from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_artist_profile
from backend.main import app
from backend.models import Album, Artist, Track


@pytest.mark.parametrize("owner", [True, False])
async def test_only_owner_can_change_plylst_link(
    db_session: AsyncSession, owner: bool
) -> None:
    artist = Artist(did="did:plc:plylst", handle="plylst.test", display_name="Artist")
    db_session.add(artist)
    await db_session.flush()
    album = Album(artist_did=artist.did, title="Demo", slug="demo")
    db_session.add(album)
    await db_session.flush()
    db_session.add(
        Track(
            artist_did=artist.did,
            album_id=album.id,
            title="Track",
            file_id="demo",
            file_type="mp3",
        )
    )
    await db_session.commit()
    session = Session(
        session_id="plylst-test",
        did=artist.did if owner else "did:plc:other",
        handle="previous-handle.test" if owner else "other.test",
        oauth_session={},
    )
    app.dependency_overrides[require_artist_profile] = lambda: session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            before = await client.get(f"/albums/{artist.handle}/{album.slug}")
            assert before.json()["metadata"]["show_plylst"] is False
            with patch(
                "backend.api.albums.mutations.update_list_record"
            ) as update_list:
                response = await client.patch(
                    f"/albums/{album.id}", params={"show_plylst": "true"}
                )
                assert response.status_code == (200 if owner else 403)
                update_list.assert_not_called()
            after = await client.get(f"/albums/{artist.handle}/{album.slug}")
            assert after.json()["metadata"]["show_plylst"] is owner
            if owner:
                response = await client.patch(
                    f"/albums/{album.id}", params={"show_plylst": "false"}
                )
                assert response.status_code == 200
                after = await client.get(f"/albums/{artist.handle}/{album.slug}")
                assert after.json()["metadata"]["show_plylst"] is False
    finally:
        app.dependency_overrides.pop(require_artist_profile, None)

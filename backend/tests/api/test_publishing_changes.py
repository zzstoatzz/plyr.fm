"""Existing-work changes prepare protected audio before committing access."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_artist_profile, require_auth
from backend.api.tracks.publishing import apply_publishing, run_publishing_change
from backend.config import settings
from backend.main import app
from backend.models import Album, Artist, Track, get_db
from backend.models.track_revision import TrackRevision
from backend.utilities.database import db_session as open_db_session
from backend.utilities.publishing import PublishingDefaults, PublishingPolicy


@pytest.fixture(autouse=True)
def pds_without_spaces(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend._internal.atproto.spaces.capability.pds_supports_spaces",
        AsyncMock(return_value=False),
    )


@pytest.fixture
async def published(db_session: AsyncSession) -> tuple[Track, Session]:
    artist = Artist(
        did="did:test:publishing", handle="publishing.test", display_name="Artist"
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="Published work",
        artist_did=artist.did,
        file_id="master",
        file_type="flac",
        audio_storage="r2",
        r2_url="https://audio.example/master.flac",
        download_policy="open",
        policy_origin="portal",
        visibility="public",
    )
    db_session.add(track)
    await db_session.commit()
    session = Session.__new__(Session)
    session.did = artist.did
    session.session_id = "publishing-session"
    return track, session


async def test_unsupported_protected_conversion_preserves_public_source(
    db_session: AsyncSession, published: tuple[Track, Session]
) -> None:
    track, session = published
    requested = PublishingDefaults(access=PublishingPolicy(downloads="off"))
    with (
        patch(
            "backend.api.tracks.publishing.storage.copy_audio_to_private", AsyncMock()
        ) as copy,
        patch(
            "backend.api.tracks.publishing._transcode_audio", AsyncMock()
        ) as transcode,
        pytest.raises(ValueError, match="PDS needs Spaces"),
    ):
        await apply_publishing(track.id, requested, "track", session)
    copy.assert_not_awaited()
    transcode.assert_not_awaited()
    await db_session.refresh(track)
    assert track.file_id == "master"
    assert track.download_policy == "open"
    assert track.audio_storage == "r2"
    assert track.r2_url == "https://audio.example/master.flac"
    assert track.protected_audio is None
    assert (
        await db_session.scalar(
            select(TrackRevision.id).where(TrackRevision.track_id == track.id)
        )
        is None
    )


async def test_supported_protected_conversion_keeps_source_without_encoding(
    db_session: AsyncSession, published: tuple[Track, Session]
) -> None:
    track, session = published
    requested = PublishingDefaults(access=PublishingPolicy(downloads="off"))
    protected = {
        "record_uri": f"at://{session.did}/space/{settings.atproto.private_media_space_type}/playback/{session.did}/{settings.atproto.track_collection}/source",
        "record_cid": "source-cid",
        "audio_blob": {
            "$type": "blob",
            "ref": {"$link": "source-blob"},
            "mimeType": "audio/flac",
            "size": 5,
        },
    }
    with (
        patch(
            "backend.api.tracks.publishing.protected_storage_choice",
            AsyncMock(return_value=True),
        ),
        patch(
            "backend.api.tracks.publishing.storage.copy_audio_to_private", AsyncMock()
        ) as copy,
        patch(
            "backend.api.tracks.publishing.publish_protected_audio",
            AsyncMock(return_value=protected),
        ),
        patch(
            "backend.api.tracks.publishing._transcode_audio", AsyncMock()
        ) as transcode,
    ):
        await apply_publishing(track.id, requested, "track", session)
    copy.assert_awaited_once_with("master", "flac")
    transcode.assert_not_awaited()
    await db_session.refresh(track)
    assert track.file_id == "master"
    assert track.protected_audio == protected
    assert track.pds_blob_cid is None
    assert track.download_policy == "off"
    assert track.audio_storage == "r2_private"
    revision = await db_session.scalar(
        select(TrackRevision).where(TrackRevision.track_id == track.id)
    )
    assert revision is not None
    assert revision.file_id == "master"
    assert revision.protected_audio is None


async def test_space_boundary_is_not_rewritten(
    db_session: AsyncSession, published: tuple[Track, Session]
) -> None:
    track, session = published
    track.visibility = "private"
    await db_session.commit()
    with pytest.raises(ValueError, match="Space boundaries"):
        await apply_publishing(track.id, PublishingDefaults(), "track", session)
    await db_session.refresh(track)
    assert track.visibility == "private"


async def test_batch_reports_partial_failure(published: tuple[Track, Session]) -> None:
    _, session = published
    with (
        patch(
            "backend.api.tracks.publishing.get_session",
            new_callable=AsyncMock,
            return_value=session,
        ),
        patch(
            "backend.api.tracks.publishing.apply_publishing",
            new_callable=AsyncMock,
            side_effect=[None, ValueError("source unavailable")],
        ),
        patch(
            "backend.api.tracks.publishing.job_service.update_progress",
            new_callable=AsyncMock,
        ) as progress,
    ):
        await run_publishing_change(
            "job",
            session.session_id,
            [1, 2],
            PublishingDefaults().model_dump(),
            "album",
        )
    assert progress.call_args is not None
    assert progress.call_args.kwargs["result"] == {
        "updated_track_ids": [1],
        "failed_track_ids": [2],
    }
    assert progress.call_args.args[1] == "failed"


@pytest.mark.parametrize("replace_overrides", [False, True])
async def test_album_application_selects_explicit_exceptions_only_when_requested(
    db_session: AsyncSession, published: tuple[Track, Session], replace_overrides: bool
) -> None:
    track, session = published
    album = Album(artist_did=session.did, slug="album", title="Album")
    db_session.add(album)
    await db_session.flush()
    track.album_id = album.id
    exception = Track(
        title="Exception",
        artist_did=session.did,
        album_id=album.id,
        file_id="exception",
        file_type="mp3",
        policy_origin="track",
    )
    db_session.add(exception)
    await db_session.commit()

    async def owner() -> Session:
        return session

    app.dependency_overrides[require_auth] = owner
    requested = PublishingDefaults(access=PublishingPolicy(downloads="off"))
    try:
        with patch(
            "backend.api.tracks.publishing.queue_publishing_change",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(job_id="queued"),
        ) as queue:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    f"/albums/{album.id}/publishing",
                    json={
                        "settings": requested.model_dump(),
                        "replace_overrides": replace_overrides,
                    },
                )
        assert response.status_code == 200, response.text
        expected = [track.id, exception.id] if replace_overrides else [track.id]
        assert sorted(response.json()["selected_track_ids"]) == sorted(expected)
        assert queue.call_args is not None
        assert sorted(queue.call_args.args[1]) == sorted(expected)
        await db_session.refresh(album)
        assert album.publishing_defaults == requested.model_dump()
    finally:
        app.dependency_overrides.clear()


async def test_old_access_fields_are_rejected_by_metadata_endpoint(
    published: tuple[Track, Session],
) -> None:
    track, session = published

    async def owner() -> Session:
        return session

    app.dependency_overrides[require_auth] = owner
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.patch(
                f"/tracks/{track.id}", data={"support_gate": "null"}
            )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


async def test_rights_failure_invalidates_committed_access(
    db_session: AsyncSession, published: tuple[Track, Session]
) -> None:
    track, session = published
    album = Album(artist_did=session.did, slug="rights-failure", title="Rights failure")
    db_session.add(album)
    await db_session.flush()
    track.album_id = album.id
    await db_session.commit()
    requested = PublishingDefaults(
        access=PublishingPolicy(visibility="unlisted"), attach_rights=True
    )
    with (
        patch(
            "backend.api.tracks.publishing.get_user_copyright_config",
            new_callable=AsyncMock,
            return_value={"configured": True},
        ),
        patch(
            "backend.api.tracks.publishing.write_track_rights",
            new_callable=AsyncMock,
            side_effect=ValueError("rights service unavailable"),
        ),
        patch(
            "backend.api.tracks.publishing.invalidate_album_cache_by_id",
            new_callable=AsyncMock,
        ) as album_cache,
        patch(
            "backend.api.tracks.publishing.invalidate_tracks_discovery_cache",
            new_callable=AsyncMock,
        ) as discovery_cache,
    ):
        with pytest.raises(ValueError, match="rights service unavailable"):
            await apply_publishing(track.id, requested, "track", session)
        album_cache.assert_awaited_once()
        discovery_cache.assert_awaited_once()
    await db_session.refresh(track)
    assert track.visibility == "unlisted"
    assert track.copyright_song_uri is None


async def test_album_queue_failure_reports_saved_defaults(
    db_session: AsyncSession, published: tuple[Track, Session]
) -> None:
    track, session = published
    album = Album(artist_did=session.did, slug="queue-failure", title="Queue failure")
    db_session.add(album)
    await db_session.flush()
    track.album_id = album.id
    await db_session.commit()
    requested = PublishingDefaults(access=PublishingPolicy(downloads="off"))

    async def owner() -> Session:
        return session

    app.dependency_overrides[require_auth] = owner
    try:
        with patch(
            "backend.api.tracks.publishing.queue_publishing_change",
            new_callable=AsyncMock,
            side_effect=ConnectionError("queue unavailable"),
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    f"/albums/{album.id}/publishing",
                    json={"settings": requested.model_dump()},
                )
        assert response.status_code == 503
        assert "album defaults saved" in response.json()["detail"]
        await db_session.refresh(album)
        await db_session.refresh(track)
        assert album.publishing_defaults == requested.model_dump()
        assert track.download_policy == "open"
    finally:
        app.dependency_overrides.clear()


async def test_concurrent_album_creation_does_not_accept_another_policy(
    db_session: AsyncSession, published: tuple[Track, Session]
) -> None:
    _, session = published
    original_flush = db_session.flush

    async def concurrent_flush() -> None:
        async with open_db_session() as competitor:
            competitor.add(
                Album(
                    artist_did=session.did,
                    slug="concurrent",
                    title="Concurrent",
                    publishing_defaults=PublishingDefaults().model_dump(),
                )
            )
            await competitor.commit()
        await original_flush()

    async def owner() -> Session:
        return session

    async def request_db() -> AsyncSession:
        return db_session

    app.dependency_overrides[require_artist_profile] = owner
    app.dependency_overrides[get_db] = request_db
    try:
        with patch.object(db_session, "flush", side_effect=concurrent_flush):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    "/albums/",
                    json={
                        "title": "Concurrent",
                        "publishing_defaults": PublishingDefaults(
                            access=PublishingPolicy(downloads="off")
                        ).model_dump(),
                    },
                )
        assert response.status_code == 409
        assert "retry" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()

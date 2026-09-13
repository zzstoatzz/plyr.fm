"""Changing downloads back on republishes PDS audio through the real policy job."""

from collections.abc import AsyncIterable, AsyncIterator, Callable
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.api.tracks.publishing import run_publishing_change
from backend.main import app
from backend.models import Artist, Track, UserPreferences
from backend.utilities.publishing import (
    DownloadPolicy,
    PublicationVisibility,
    PublishingDefaults,
    PublishingPolicy,
)


@pytest.mark.parametrize("visibility", ["public", "unlisted"])
@pytest.mark.parametrize("downloads", ["open", "ask"])
async def test_download_roundtrip_restores_pds_record(
    db_session: AsyncSession,
    visibility: PublicationVisibility,
    downloads: DownloadPolicy,
) -> None:
    artist = Artist(
        did="did:test:roundtrip", handle="roundtrip.test", display_name="Artist"
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        artist_did=artist.did,
        title="roundtrip",
        description="keep this description",
        file_id="playback",
        file_type="mp3",
        original_file_id="master",
        original_file_type="wav",
        audio_storage="both",
        r2_url="https://audio.example/audio/playback.mp3",
        pds_blob_cid="old-cid",
        pds_blob_size=5,
        visibility=visibility,
        download_policy=downloads,
        atproto_record_uri="at://did:test:roundtrip/fm.plyr.track/test",
    )
    db_session.add(track)
    await db_session.commit()
    session = Session.__new__(Session)
    session.did = artist.did
    session.session_id = "roundtrip-session"

    async def owner() -> Session:
        return session

    async def enqueue(
        job_id: str, session_id: str, track_ids: list[int], settings: dict, origin: str
    ) -> None:
        await run_publishing_change(job_id, session_id, track_ids, settings, origin)

    async def source(*args: object, **kwargs: object) -> AsyncIterator[bytes]:
        assert kwargs["private"] is True
        yield b"audio"

    async def upload(
        _session: Session,
        *,
        body_factory: Callable[[], AsyncIterable[bytes]],
        content_length: int,
        content_type: str,
    ) -> dict:
        assert b"".join([chunk async for chunk in body_factory()]) == b"audio"
        return {
            "$type": "blob",
            "ref": {"$link": "restored-cid"},
            "size": 5,
            "mimeType": "audio/mpeg",
        }

    app.dependency_overrides[require_auth] = owner
    try:
        with (
            patch(
                "backend.api.tracks.publishing.get_session",
                AsyncMock(return_value=session),
            ),
            patch("backend.api.tracks.publishing.get_docket") as docket,
            patch(
                "backend.api.tracks.publishing.storage.copy_audio_to_private",
                AsyncMock(),
            ),
            patch(
                "backend._internal.pds_audio.storage.head_file",
                AsyncMock(return_value=5),
            ),
            patch("backend._internal.pds_audio.storage.stream_file_data", source),
            patch(
                "backend._internal.pds_audio.upload_blob", AsyncMock(side_effect=upload)
            ) as pds,
            patch(
                "backend.api.tracks.publishing_public.storage.copy_audio_to_public",
                AsyncMock(return_value="https://audio.example/audio/playback.mp3"),
            ) as copies,
            patch(
                "backend._internal.atproto.records.fm_plyr.track.update_record",
                AsyncMock(return_value=(track.atproto_record_uri, "record-cid")),
            ) as record,
        ):
            docket.return_value.add.return_value = enqueue
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                modes: list[DownloadPolicy] = ["off", downloads]
                for mode in modes:
                    settings = PublishingDefaults(
                        access=PublishingPolicy(visibility=visibility, downloads=mode)
                    )
                    response = await client.post(
                        f"/tracks/{track.id}/publishing",
                        json={"settings": settings.model_dump()},
                    )
                    assert response.status_code == 200, response.text
                    status = await client.get(
                        f"/tracks/publishing-jobs/{response.json()['job_id']}"
                    )
                    assert status.json()["status"] == "completed", status.text
                    await db_session.refresh(track)
                    written = record.call_args.kwargs["record"]
                    assert written["description"] == "keep this description"
                    if mode == "off":
                        assert "audioBlob" not in written
                        assert track.audio_storage == "r2_private"
                        pds.assert_not_awaited()
                    else:
                        assert written["audioBlob"]["ref"]["$link"] == "restored-cid"
                        assert (
                            written["audioUrl"]
                            == "https://audio.example/audio/playback.mp3"
                        )
                        assert track.audio_storage == "both"
                        assert track.pds_blob_cid == "restored-cid"
                        assert track.download_policy == downloads
                        assert track.original_file_id == "master"
            pds.assert_awaited_once()
            copies.assert_any_await("playback", "mp3")
            copies.assert_any_await("master", "wav")
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "outcome", ["opt_out", "upload_failure", "record_failure", "restricted"]
)
async def test_public_preparation_respects_existing_storage_contract(
    db_session: AsyncSession, outcome: str
) -> None:
    artist = Artist(
        did="did:test:prepare", handle="prepare.test", display_name="Artist"
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        artist_did=artist.did,
        title="protected",
        file_id="playback",
        file_type="mp3",
        original_file_id="master",
        original_file_type="wav",
        audio_storage="r2_private",
        download_policy="off",
        atproto_record_uri="at://did:test:prepare/fm.plyr.track/test",
    )
    db_session.add(track)
    if outcome == "opt_out":
        db_session.add(
            UserPreferences(
                did=artist.did, ui_settings={"pds_audio_uploads_enabled": False}
            )
        )
    await db_session.commit()
    session = Session.__new__(Session)
    session.did = artist.did
    session.session_id = "prepare-session"
    requested = PublishingDefaults(
        access=PublishingPolicy(
            listening="signed_in" if outcome == "restricted" else "public"
        )
    )
    with (
        patch(
            "backend.api.tracks.publishing.get_session", AsyncMock(return_value=session)
        ),
        patch(
            "backend._internal.pds_audio.storage.head_file", AsyncMock(return_value=5)
        ),
        patch(
            "backend._internal.pds_audio.upload_blob",
            AsyncMock(
                side_effect=ConnectionError("PDS unavailable")
                if outcome == "upload_failure"
                else None,
                return_value={"ref": {"$link": "restored-cid"}, "size": 5},
            ),
        ) as upload,
        patch(
            "backend.api.tracks.publishing_public.storage.copy_audio_to_public",
            AsyncMock(return_value="https://audio.example/audio/playback.mp3"),
        ) as copy,
        patch(
            "backend._internal.atproto.records.fm_plyr.track.update_record",
            AsyncMock(
                side_effect=ConnectionError("record unavailable")
                if outcome == "record_failure"
                else None,
                return_value=(track.atproto_record_uri, "new-cid"),
            ),
        ),
        patch(
            "backend.api.tracks.publishing.job_service.update_progress", AsyncMock()
        ) as progress,
    ):
        await run_publishing_change(
            "job", session.session_id, [track.id], requested.model_dump(), "track"
        )
        await db_session.refresh(track)
        assert progress.call_args is not None
        result = progress.call_args.kwargs["result"]
        if outcome.endswith("failure"):
            assert result["failed_track_ids"] == [track.id]
            assert track.audio_storage == "r2_private"
            assert track.download_policy == "off"
            assert track.pds_blob_cid is None
            if outcome == "upload_failure":
                copy.assert_not_awaited()
        else:
            assert result["updated_track_ids"] == [track.id]
            upload.assert_not_awaited()
            assert track.pds_blob_cid is None
            if outcome == "restricted":
                copy.assert_not_awaited()
                assert track.audio_storage == "r2_private"
            else:
                assert track.audio_storage == "r2"
                copy.assert_any_await("master", "wav")

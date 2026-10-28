"""Protected source pointers survive public record and revision lifecycles."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.records.fm_plyr.track import (
    audio_blob_ref,
    build_track_record,
)
from backend._internal.track_revisions import delete_unreferenced_protected_audio
from backend.api.tracks.audio_replace import (
    ReplaceContext,
    _process_replace_background,
    _rollback_new_files,
)
from backend.api.tracks.publishing import apply_publishing
from backend.config import settings
from backend.models import Artist, TrackRevision
from backend.storage import _get_storage
from backend.utilities.publishing import PublishingDefaults, PublishingPolicy

from ._helpers import OWNER_DID, TRACK_URI, MockSession, make_track


def asset(name: str) -> dict:
    return {
        "record_uri": f"at://{OWNER_DID}/space/{settings.atproto.private_media_space_type}/playback/{OWNER_DID}/{settings.atproto.track_collection}/{name}",
        "record_cid": f"record-{name}",
        "audio_blob": {
            "$type": "blob",
            "ref": {"$link": f"blob-{name}"},
            "mimeType": "audio/mpeg",
            "size": 5,
        },
    }


async def test_public_record_points_to_space_without_exposing_blob() -> None:
    protected = asset("source")
    record = await build_track_record(
        title="protected",
        artist="Owner",
        file_type="mp3",
        audio_url="https://api.example/audio/playback",
        audio_space=protected["record_uri"],
        download_policy="off",
    )
    assert record["audioSpace"] == protected["record_uri"]
    assert record["downloadPolicy"] == "off"
    assert "audioBlob" not in record
    with pytest.raises(ValueError, match="public blob"):
        await build_track_record(
            title="protected",
            artist="Owner",
            file_type="mp3",
            audio_space=protected["record_uri"],
            audio_blob=protected["audio_blob"],
        )


def test_rebuild_never_treats_protected_blob_as_public() -> None:
    track = make_track()
    track.protected_audio = asset("source")
    track.pds_blob_cid = "stale-public-column"
    assert audio_blob_ref(track) is None


async def test_restore_preserves_space_source_and_displaced_asset(
    test_app_owner: FastAPI, db_session: AsyncSession, owner: Artist
) -> None:
    track = make_track(file_id="current")
    track.audio_storage = "r2_private"
    track.r2_url = None
    track.download_policy = "off"
    track.protected_audio = asset("current")
    db_session.add(track)
    await db_session.flush()
    revision = TrackRevision(
        track_id=track.id,
        file_id="old",
        file_type="mp3",
        audio_storage="r2_private",
        audio_url=None,
        was_gated=True,
        protected_audio=asset("old"),
    )
    db_session.add(revision)
    await db_session.commit()
    track_id, revision_id = track.id, revision.id
    with patch(
        "backend.api.tracks.revisions.update_record",
        AsyncMock(return_value=(TRACK_URI, "restored-cid")),
    ) as update:
        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/tracks/{track_id}/revisions/{revision_id}/restore"
            )
    assert response.status_code == 200, response.text
    assert response.json()["audio_space"] == asset("current")["record_uri"]
    record = update.call_args.kwargs["record"]
    assert record["audioSpace"] == asset("old")["record_uri"]
    assert "audioBlob" not in record
    await db_session.refresh(track)
    assert track.protected_audio == asset("old")
    assert track.pds_blob_cid is None
    snapshot = await db_session.scalar(
        select(TrackRevision).where(TrackRevision.track_id == track_id)
    )
    assert snapshot is not None
    assert snapshot.protected_audio == asset("current")


async def test_protected_asset_cleanup_preserves_live_and_revision_references(
    db_session: AsyncSession, owner: Artist
) -> None:
    track = make_track()
    track.protected_audio = asset("shared")
    db_session.add(track)
    await db_session.flush()
    revision = TrackRevision(
        track_id=track.id,
        file_id="prior",
        file_type="mp3",
        audio_storage="r2_private",
        was_gated=True,
        protected_audio=asset("revision"),
    )
    db_session.add(revision)
    await db_session.commit()
    orphan = asset("orphan")
    with patch(
        "backend._internal.atproto.spaces.protected_audio.delete_space_record",
        AsyncMock(),
    ) as delete:
        await delete_unreferenced_protected_audio(
            MockSession(), [asset("shared"), asset("revision"), orphan, orphan]
        )
    delete.assert_awaited_once()
    assert delete.call_args.args[1] == orphan["record_uri"]


@pytest.mark.parametrize("extension", ["mp3", "aif"])
async def test_replace_publishes_pds_source_when_r2_mirror_fails(
    test_app_owner: FastAPI, db_session: AsyncSession, owner: Artist, extension: str
) -> None:
    track = make_track(file_id="prior")
    track.audio_storage = "r2_private"
    track.r2_url = None
    track.download_policy = "off"
    track.protected_audio = asset("prior")
    db_session.add(track)
    await db_session.commit()
    track_id = track.id
    payload = b"ID3" + b"\x00" * 128
    protected = asset("replacement")
    order: list[str] = []

    async def save_source(session: MockSession, path: str, **kwargs: object) -> dict:
        with open(path, "rb") as source:
            assert source.read() == payload
        assert kwargs["title"] == track.title
        assert kwargs["file_type"] == extension
        assert kwargs["needs_optimization"] is (extension == "aif")
        order.append("pds")
        return protected

    async def fail_mirror(*args: object, **kwargs: object) -> str:
        order.append("r2")
        raise OSError("R2 unavailable")

    async def consume(ctx: ReplaceContext) -> None:
        await _process_replace_background(ctx)

    with (
        patch("backend.api.tracks.audio_replace.protect_audio_file", save_source),
        patch("backend.api.tracks.audio_replace.stage_audio_to_storage", fail_mirror),
        patch("backend.api.tracks.audio_replace.schedule_track_audio_replace", consume),
        patch(
            "backend.api.tracks.audio_optimize.schedule_optimize_track_audio",
            AsyncMock(),
        ),
        patch(
            "backend.api.tracks.audio_replace.update_record",
            AsyncMock(return_value=(TRACK_URI, "new-public-cid")),
        ) as update,
        patch(
            "backend.api.tracks.audio_replace.run_post_track_audio_replace_hooks",
            AsyncMock(),
        ),
        patch(
            "backend.api.tracks.audio_replace.invalidate_tracks_discovery_cache",
            AsyncMock(),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            response = await client.put(
                f"/tracks/{track_id}/audio",
                files={"file": (f"replacement.{extension}", payload, "audio/mpeg")},
            )
    assert response.status_code == 200, response.text
    assert order == ["pds", "r2"]
    record = update.call_args.kwargs["record"]
    assert record["audioSpace"] == protected["record_uri"]
    assert record["fileType"] == extension
    assert "audioBlob" not in record
    await db_session.refresh(track)
    assert track.protected_audio == protected
    assert track.file_type == extension
    assert track.pds_blob_cid is None
    prior = await db_session.scalar(
        select(TrackRevision).where(TrackRevision.track_id == track_id)
    )
    assert prior is not None
    assert prior.protected_audio == asset("prior")


async def test_enabling_downloads_keeps_owned_space_source(
    db_session: AsyncSession, owner: Artist
) -> None:
    track = make_track()
    track.audio_storage = "r2_private"
    track.r2_url = None
    track.download_policy = "off"
    track.protected_audio = asset("owned")
    db_session.add(track)
    await db_session.commit()
    captured: list[dict] = []

    async def pds(
        session: MockSession,
        method: str,
        endpoint: str,
        payload: dict | None = None,
        **kwargs: object,
    ) -> dict:
        if method == "GET":
            assert endpoint == "com.atproto.repo.getRecord"
            return {
                "uri": TRACK_URI,
                "cid": "old-cid",
                "value": {
                    "$type": settings.atproto.track_collection,
                    "title": track.title,
                    "artist": owner.display_name,
                    "fileType": "mp3",
                    "createdAt": track.created_at.isoformat(),
                    "audioSpace": asset("owned")["record_uri"],
                    "downloadPolicy": "off",
                },
            }
        assert endpoint == "com.atproto.repo.putRecord"
        assert payload is not None
        captured.append(payload["record"])
        return {"uri": TRACK_URI, "cid": "new-cid"}

    with (
        patch("backend._internal.atproto.records.fm_plyr.track.make_pds_request", pds),
        patch(
            "backend.api.tracks.publishing.invalidate_tracks_discovery_cache",
            AsyncMock(),
        ),
        patch(
            "backend.api.tracks.publishing_public.storage.copy_audio_to_public",
            AsyncMock(side_effect=AssertionError("R2 must not gate this change")),
        ),
    ):
        await apply_publishing(
            track.id,
            PublishingDefaults(access=PublishingPolicy(downloads="open")),
            "track",
            MockSession(),
        )
    await db_session.refresh(track)
    assert track.protected_audio == asset("owned")
    assert track.audio_storage == "r2_private"
    assert track.download_policy == "open"
    assert captured[0]["downloadPolicy"] == "open"
    assert captured[0]["audioSpace"] == asset("owned")["record_uri"]
    assert "audioBlob" not in captured[0]


@pytest.mark.parametrize("same_source", [True, False])
async def test_failed_replacement_keeps_the_live_mirror_and_pds_source(
    db_session: AsyncSession, owner: Artist, same_source: bool
) -> None:
    track = make_track(file_id="live")
    track.audio_storage = "r2_private"
    track.protected_audio = asset("live")
    track.r2_url = None
    db_session.add(track)
    await db_session.commit()
    remote_objects = {"live": b"published audio", "new": b"abandoned audio"}

    async def delete(
        storage_instance: object, file_id: str, file_type: str | None = None
    ) -> bool:
        return remote_objects.pop(file_id, None) is not None

    with patch.object(type(_get_storage()), "delete_gated", delete):
        await _rollback_new_files(
            "live" if same_source else "new", "mp3", None, None, gated=True
        )
    assert remote_objects["live"] == b"published audio"
    if not same_source:
        assert "new" not in remote_objects
    await db_session.refresh(track)
    assert track.file_id == "live"
    assert track.protected_audio == asset("live")

"""regression: orphan-cleanup contract for the upload pipeline.

context: the HTTP handler stages audio + image to shared object storage
BEFORE enqueueing the docket task (a docket worker may run on a
different fly machine than the request handler, so /tmp paths can't
cross that boundary). that means by the time `_process_upload_background`
runs, durable storage objects already exist that the worker hasn't yet
taken DB ownership of.

the contract this file verifies:

  * any abort during phases 1-5 (before `_create_records` reserves a
    DB row) MUST delete the staged audio_file_id and image_id;
  * once `_create_records` is entered, the orchestrator-level cleanup
    is suppressed because `_create_records` itself runs the
    reserve-then-publish cleanup (which knows whether the row was
    finalized by Jetstream or is still ours to delete);
  * for transcoded uploads, the rollback covers BOTH the lossless
    source (now `original_file_id`) and the transcoded sibling.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from backend._internal import Session as AuthSession
from backend._internal.audio import AudioFormat
from backend.api.tracks.uploads import (
    AudioInfo,
    StorageResult,
    TranscodeInfo,
    UploadContext,
    UploadPhaseError,
    _process_upload_background,
)


def _session() -> AuthSession:
    return AuthSession(
        session_id="sess-1",
        did="did:plc:test",
        handle="test.bsky.social",
        oauth_session={"access_token": "tok"},
    )


def _ctx(*, gated: bool = False, with_image: bool = True) -> UploadContext:
    return UploadContext(
        upload_id="upload-1",
        auth_session=_session(),
        audio_file_id="staged-audio-id",
        filename="song.mp3",
        duration=90,
        title="t",
        artist_did="did:plc:test",
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        image_id="staged-image-id" if with_image else None,
        image_url=(
            "https://images.example/staged-image-id.jpg" if with_image else None
        ),
        thumbnail_url=(
            "https://images.example/staged-image-id_thumb.jpg" if with_image else None
        ),
        support_gate={"type": "any"} if gated else None,
    )


class TestPhase1To5FailureDeletesStagedMedia:
    """phases 1-5 raising must delete the handler-staged storage objects."""

    async def test_validate_audio_failure_deletes_audio_and_image(self) -> None:
        with (
            patch(
                "backend.api.tracks.uploads._validate_audio",
                AsyncMock(side_effect=UploadPhaseError("bad audio")),
            ),
            patch(
                "backend.api.tracks.uploads.storage.delete",
                AsyncMock(return_value=True),
            ) as mock_delete,
            patch(
                "backend.api.tracks.uploads.storage.delete_gated",
                AsyncMock(return_value=True),
            ) as mock_delete_gated,
            patch("backend.api.tracks.uploads.job_service", AsyncMock()),
        ):
            await _process_upload_background(_ctx(gated=False))

        # non-gated → audio in public bucket
        deleted_ids = [c.args[0] for c in mock_delete.call_args_list]
        assert "staged-audio-id" in deleted_ids
        assert "staged-image-id" in deleted_ids
        mock_delete_gated.assert_not_called()

    async def test_gated_audio_deleted_from_private_bucket(self) -> None:
        with (
            patch(
                "backend.api.tracks.uploads._validate_audio",
                AsyncMock(side_effect=UploadPhaseError("bad audio")),
            ),
            patch(
                "backend.api.tracks.uploads.storage.delete",
                AsyncMock(return_value=True),
            ) as mock_delete,
            patch(
                "backend.api.tracks.uploads.storage.delete_gated",
                AsyncMock(return_value=True),
            ) as mock_delete_gated,
            patch("backend.api.tracks.uploads.job_service", AsyncMock()),
        ):
            await _process_upload_background(_ctx(gated=True))

        # gated → staged audio lives in the private bucket; rollback
        # must route the audio delete to delete_gated. images are
        # never gated.
        deleted_gated_ids = [c.args[0] for c in mock_delete_gated.call_args_list]
        assert deleted_gated_ids == ["staged-audio-id"]
        deleted_public_ids = [c.args[0] for c in mock_delete.call_args_list]
        assert "staged-audio-id" not in deleted_public_ids
        assert "staged-image-id" in deleted_public_ids

    async def test_transcoded_failure_deletes_both_sibling_and_original(
        self,
    ) -> None:
        """if `_check_duplicate` fails AFTER `_store_audio` produced a
        transcoded sibling, BOTH the transcoded file (`sr.file_id`) and
        the lossless source (`sr.original_file_id`, = ctx.audio_file_id)
        must be cleaned up.
        """
        sr = StorageResult(
            file_id="transcoded-mp3-id",
            original_file_id="staged-audio-id",  # the lossless source
            original_file_type="flac",
            playable_format=AudioFormat.MP3,
            r2_url="https://audio.example/transcoded-mp3-id.mp3",
            transcode_info=TranscodeInfo(
                original_file_id="staged-audio-id",
                original_file_type="flac",
                transcoded_file_id="transcoded-mp3-id",
                transcoded_file_type="mp3",
                transcoded_data=b"",
            ),
        )
        with (
            patch(
                "backend.api.tracks.uploads._validate_audio",
                AsyncMock(
                    return_value=AudioInfo(
                        format=AudioFormat.FLAC, duration=90, is_gated=False
                    )
                ),
            ),
            patch(
                "backend.api.tracks.uploads._store_audio",
                AsyncMock(return_value=sr),
            ),
            patch(
                "backend.api.tracks.uploads._check_duplicate",
                AsyncMock(side_effect=UploadPhaseError("dup")),
            ),
            patch(
                "backend.api.tracks.uploads.storage.delete",
                AsyncMock(return_value=True),
            ) as mock_delete,
            patch("backend.api.tracks.uploads.job_service", AsyncMock()),
        ):
            await _process_upload_background(_ctx(gated=False))

        deleted_ids = [c.args[0] for c in mock_delete.call_args_list]
        assert "transcoded-mp3-id" in deleted_ids  # the playable sibling
        assert "staged-audio-id" in deleted_ids  # the lossless source
        assert "staged-image-id" in deleted_ids  # the cover art


class TestPhase6FailureDefersToCreateRecords:
    """once `_create_records` is entered, the orchestrator MUST NOT run
    its own storage cleanup — `_create_records` already implements the
    reserve-then-publish cleanup that knows whether Jetstream took
    ownership of the row.
    """

    async def test_create_records_failure_does_not_double_delete(self) -> None:
        sr = StorageResult(
            file_id="staged-audio-id",
            original_file_id=None,
            original_file_type=None,
            playable_format=AudioFormat.MP3,
            r2_url="https://audio.example/staged-audio-id.mp3",
            transcode_info=None,
        )
        with (
            patch(
                "backend.api.tracks.uploads._validate_audio",
                AsyncMock(
                    return_value=AudioInfo(
                        format=AudioFormat.MP3, duration=90, is_gated=False
                    )
                ),
            ),
            patch(
                "backend.api.tracks.uploads._store_audio",
                AsyncMock(return_value=sr),
            ),
            patch(
                "backend.api.tracks.uploads._check_duplicate",
                AsyncMock(return_value=None),
            ),
            patch(
                "backend.api.tracks.uploads._upload_to_pds",
                AsyncMock(return_value=None),
            ),
            patch(
                "backend.api.tracks.uploads._store_image",
                AsyncMock(return_value=(None, None, None)),
            ),
            patch(
                "backend.api.tracks.uploads._create_records",
                AsyncMock(side_effect=UploadPhaseError("PDS exploded")),
            ),
            patch(
                "backend.api.tracks.uploads.storage.delete",
                AsyncMock(return_value=True),
            ) as mock_delete,
            patch(
                "backend.api.tracks.uploads.storage.delete_gated",
                AsyncMock(return_value=True),
            ) as mock_delete_gated,
            patch("backend.api.tracks.uploads.job_service", AsyncMock()),
        ):
            await _process_upload_background(_ctx(gated=False))

        # the orchestrator must not delete — _create_records owns the
        # cleanup logic past this boundary. (this test patches
        # _create_records itself so we don't observe any of its
        # internal cleanup; we're asserting the orchestrator-level
        # cleanup does NOT fire, regardless of what _create_records does.)
        mock_delete.assert_not_called()
        mock_delete_gated.assert_not_called()

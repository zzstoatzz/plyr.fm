"""regression test: session reload between PDS upload and record creation.

After upload_blob refreshes the OAuth token, _process_upload_background must
reload ctx.auth_session from DB so that create_track_record uses the new token.
See: https://github.com/…/plyr.fm/issues/XXX
"""

from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

from backend._internal import Session as AuthSession
from backend._internal.audio import AudioFormat
from backend.api.tracks.uploads import (
    AudioInfo,
    PdsBlobResult,
    StorageResult,
    UploadContext,
    _process_upload_background,
)


def _make_session(token: str = "old-token") -> AuthSession:
    return AuthSession(
        session_id="sess-1",
        did="did:plc:test",
        handle="test.bsky.social",
        oauth_session={"access_token": token},
    )


@dataclass
class _FakeTrack:
    id: str = "track-1"


class TestSessionReloadAfterPdsUpload:
    """ctx.auth_session must reflect DB state before _create_records runs."""

    async def test_session_reloaded_after_pds_upload(self) -> None:
        """If PDS upload refreshed the token, ctx.auth_session should be updated."""
        old_session = _make_session("old-token")
        refreshed_session = _make_session("new-token")

        ctx = UploadContext(
            upload_id="upload-1",
            auth_session=old_session,
            file_path="/tmp/fake.mp3",
            filename="fake.mp3",
            title="test track",
            artist_did="did:plc:test",
            album=None,
            album_id=None,
            features_json=None,
            tags=[],
        )

        audio_info = AudioInfo(format=AudioFormat.MP3, duration=60, is_gated=False)
        storage_result = StorageResult(
            file_id="file-1",
            original_file_id=None,
            original_file_type=None,
            playable_format=AudioFormat.MP3,
            r2_url="https://cdn.example.com/file-1.mp3",
            transcode_info=None,
        )
        pds_result = PdsBlobResult(
            blob_ref={"ref": {"$link": "bafytest"}},
            cid="bafytest",
            size=1024,
        )

        session_passed_to_create_records: AuthSession | None = None

        async def fake_create_records(
            ctx: UploadContext, *args: object, **kwargs: object
        ) -> _FakeTrack:
            nonlocal session_passed_to_create_records
            session_passed_to_create_records = ctx.auth_session
            return _FakeTrack()

        with (
            patch(
                "backend.api.tracks.uploads.job_service",
                AsyncMock(),
            ),
            patch(
                "backend.api.tracks.uploads._validate_audio",
                return_value=audio_info,
            ),
            patch(
                "backend.api.tracks.uploads._store_audio",
                return_value=storage_result,
            ),
            patch(
                "backend.api.tracks.uploads._check_duplicate",
                return_value=None,
            ),
            patch(
                "backend.api.tracks.uploads._upload_to_pds",
                return_value=pds_result,
            ),
            patch(
                "backend.api.tracks.uploads._store_image",
                return_value=(None, None, None),
            ),
            patch(
                "backend.api.tracks.uploads._create_records",
                side_effect=fake_create_records,
            ),
            patch(
                "backend.api.tracks.uploads._schedule_post_upload",
                return_value=None,
            ),
            patch(
                "backend._internal.get_session",
                return_value=refreshed_session,
            ),
        ):
            await _process_upload_background(ctx)

        assert session_passed_to_create_records is not None
        assert (
            session_passed_to_create_records.oauth_session["access_token"]
            == "new-token"
        ), "create_records should see the refreshed token, not the stale one"

    async def test_session_not_reloaded_when_pds_skipped(self) -> None:
        """If PDS upload returned None (skipped), no reload should happen."""
        old_session = _make_session("old-token")

        ctx = UploadContext(
            upload_id="upload-2",
            auth_session=old_session,
            file_path="/tmp/fake.mp3",
            filename="fake.mp3",
            title="test track",
            artist_did="did:plc:test",
            album=None,
            album_id=None,
            features_json=None,
            tags=[],
        )

        session_passed_to_create_records: AuthSession | None = None

        async def fake_create_records(
            ctx: UploadContext, *args: object, **kwargs: object
        ) -> _FakeTrack:
            nonlocal session_passed_to_create_records
            session_passed_to_create_records = ctx.auth_session
            return _FakeTrack()

        get_session_mock = AsyncMock(return_value=_make_session("should-not-see"))

        with (
            patch("backend.api.tracks.uploads.job_service", AsyncMock()),
            patch(
                "backend.api.tracks.uploads._validate_audio",
                return_value=AudioInfo(
                    format=AudioFormat.MP3, duration=60, is_gated=False
                ),
            ),
            patch(
                "backend.api.tracks.uploads._store_audio",
                return_value=StorageResult(
                    file_id="f2",
                    original_file_id=None,
                    original_file_type=None,
                    playable_format=AudioFormat.MP3,
                    r2_url="https://cdn.example.com/f2.mp3",
                    transcode_info=None,
                ),
            ),
            patch("backend.api.tracks.uploads._check_duplicate", return_value=None),
            patch("backend.api.tracks.uploads._upload_to_pds", return_value=None),
            patch(
                "backend.api.tracks.uploads._store_image",
                return_value=(None, None, None),
            ),
            patch(
                "backend.api.tracks.uploads._create_records",
                side_effect=fake_create_records,
            ),
            patch(
                "backend.api.tracks.uploads._schedule_post_upload",
                return_value=None,
            ),
            patch("backend._internal.get_session", get_session_mock),
        ):
            await _process_upload_background(ctx)

        get_session_mock.assert_not_called()
        assert session_passed_to_create_records is not None
        assert (
            session_passed_to_create_records.oauth_session["access_token"]
            == "old-token"
        ), "session should remain unchanged when PDS upload is skipped"

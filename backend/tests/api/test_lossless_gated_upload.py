"""regression test: lossless upload with supporter gate must not error.

bug #1408: uploading a lossless format (AIFF/FLAC) with `support_gate`
set raised `UploadPhaseError("supporter-gated tracks cannot use lossless
formats yet")` in `_store_audio`. the fix removed the blanket rejection
and threads `gated=True` through to `_transcode_audio` so the WAV
compatibility rendition lands in the private bucket.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from backend._internal import Session as AuthSession
from backend._internal.audio import AudioFormat
from backend.api.tracks.uploads import (
    AudioInfo,
    TranscodeInfo,
    UploadContext,
    _store_audio,
)


def _session() -> AuthSession:
    return AuthSession(
        session_id="sess-lossless-gated",
        did="did:plc:test",
        handle="test.bsky.social",
        oauth_session={"access_token": "tok"},
    )


def _ctx(*, gated: bool = True) -> UploadContext:
    return UploadContext(
        upload_id="test-lossless-gated",
        auth_session=_session(),
        audio_file_id="staged-lossless-id",
        filename="song.aiff",
        duration=120,
        title="test",
        artist_did="did:plc:test",
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        support_gate={"type": "any"} if gated else None,
    )


async def test_lossless_gated_store_audio_succeeds() -> None:
    """lossless + gated must not raise; result must use private storage."""
    tx = TranscodeInfo(
        original_file_id="staged-lossless-id",
        original_file_type="aiff",
        transcoded_file_id="transcoded-wav-id",
        transcoded_file_type="wav",
    )
    audio_info = AudioInfo(format=AudioFormat.AIFF, duration=120, is_gated=True)
    ctx = _ctx(gated=True)

    with patch(
        "backend.api.tracks.uploads._transcode_audio",
        AsyncMock(return_value=tx),
    ):
        sr = await _store_audio(ctx, audio_info)

    assert sr.file_id == "transcoded-wav-id"
    assert sr.original_file_id == "staged-lossless-id"
    assert sr.playable_format == AudioFormat.WAV
    assert sr.r2_url is None  # gated: no public URL
    assert sr.needs_optimization is True  # lossless source was transcoded


async def test_lossless_public_store_audio_gets_public_url() -> None:
    """non-gated lossless (AIFF) uploads still get a public r2_url."""
    tx = TranscodeInfo(
        original_file_id="staged-lossless-id",
        original_file_type="aiff",
        transcoded_file_id="transcoded-wav-id",
        transcoded_file_type="wav",
    )
    audio_info = AudioInfo(format=AudioFormat.AIFF, duration=90, is_gated=False)
    ctx = _ctx(gated=False)

    with (
        patch(
            "backend.api.tracks.uploads._transcode_audio",
            AsyncMock(return_value=tx),
        ),
        patch(
            "backend.api.tracks.uploads.storage.get_url",
            AsyncMock(return_value="https://mock.r2.dev/transcoded-wav-id"),
        ),
    ):
        sr = await _store_audio(ctx, audio_info)

    assert sr.r2_url == "https://mock.r2.dev/transcoded-wav-id"
    assert sr.file_id == "transcoded-wav-id"
    assert sr.needs_optimization is True


async def test_gated_param_forwarded_to_transcode() -> None:
    """the `gated` parameter from _store_audio must reach _transcode_audio."""
    audio_info = AudioInfo(format=AudioFormat.AIFF, duration=120, is_gated=True)
    ctx = _ctx(gated=True)

    with patch(
        "backend.api.tracks.uploads._transcode_audio",
        AsyncMock(
            return_value=TranscodeInfo(
                original_file_id="staged-lossless-id",
                original_file_type="aiff",
                transcoded_file_id="transcoded-wav-id",
                transcoded_file_type="wav",
            )
        ),
    ) as mock_transcode:
        await _store_audio(ctx, audio_info)

    _, kwargs = mock_transcode.call_args
    assert kwargs.get("gated") is True

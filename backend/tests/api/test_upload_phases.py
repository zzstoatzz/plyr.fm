"""stateless unit tests for upload pipeline phase dataclasses."""

from backend._internal.audio import AudioFormat
from backend.api.tracks.uploads import (
    AudioInfo,
    PdsBlobResult,
    StorageResult,
    UploadPhaseError,
)


def test_audio_info_dataclass():
    """AudioInfo construction and fields."""
    info = AudioInfo(format=AudioFormat.MP3, duration=120, is_gated=False)
    assert info.format == AudioFormat.MP3
    assert info.duration == 120
    assert info.is_gated is False


def test_audio_info_gated():
    """AudioInfo with gated content."""
    info = AudioInfo(format=AudioFormat.WAV, duration=60, is_gated=True)
    assert info.is_gated is True


def test_storage_result_dataclass():
    """StorageResult construction and fields."""
    sr = StorageResult(
        file_id="abc123",
        original_file_id=None,
        original_file_type=None,
        playable_format=AudioFormat.MP3,
        r2_url="https://cdn.example.com/abc123.mp3",
        transcode_info=None,
    )
    assert sr.file_id == "abc123"
    assert sr.original_file_id is None
    assert sr.playable_format == AudioFormat.MP3
    assert sr.r2_url is not None


def test_storage_result_with_transcode():
    """StorageResult with original file from transcoding."""
    sr = StorageResult(
        file_id="transcoded123",
        original_file_id="original456",
        original_file_type="flac",
        playable_format=AudioFormat.MP3,
        r2_url="https://cdn.example.com/transcoded123.mp3",
        transcode_info=None,
    )
    assert sr.original_file_id == "original456"
    assert sr.original_file_type == "flac"


def test_pds_result_defaults():
    """PdsBlobResult with None blob_cid."""
    result = PdsBlobResult(blob_ref=None, cid=None, size=None)
    assert result.blob_ref is None
    assert result.cid is None
    assert result.size is None


def test_pds_result_with_data():
    """PdsBlobResult with actual values."""
    result = PdsBlobResult(
        blob_ref={"ref": {"$link": "bafyreid123"}},
        cid="bafyreid123",
        size=1024000,
    )
    assert result.cid == "bafyreid123"
    assert result.size == 1024000


def test_upload_phase_error():
    """UploadPhaseError carries error message."""
    err = UploadPhaseError("something went wrong")
    assert err.error == "something went wrong"
    assert str(err) == "something went wrong"

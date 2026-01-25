"""tests for audio format validation."""

import pytest

from backend._internal.audio import AudioFormat


class TestAudioFormat:
    """test AudioFormat enum functionality."""

    @pytest.mark.parametrize(
        ("extension", "expected_format"),
        [
            # mp3
            (".mp3", AudioFormat.MP3),
            ("mp3", AudioFormat.MP3),
            (".MP3", AudioFormat.MP3),
            # wav
            (".wav", AudioFormat.WAV),
            ("wav", AudioFormat.WAV),
            (".WAV", AudioFormat.WAV),
            # m4a
            (".m4a", AudioFormat.M4A),
            ("m4a", AudioFormat.M4A),
            (".M4A", AudioFormat.M4A),
            # aiff (lossless)
            (".aiff", AudioFormat.AIFF),
            ("aiff", AudioFormat.AIFF),
            (".AIFF", AudioFormat.AIFF),
            # flac (lossless)
            (".flac", AudioFormat.FLAC),
            ("flac", AudioFormat.FLAC),
            (".FLAC", AudioFormat.FLAC),
        ],
    )
    def test_from_extension_supported(
        self, extension: str, expected_format: AudioFormat
    ):
        """test supported extension recognition (case-insensitive, with/without dot)."""
        assert AudioFormat.from_extension(extension) == expected_format

    @pytest.mark.parametrize(
        "extension",
        [
            ".ogg",
            ".aac",
            ".wma",
            ".aif",  # only .aiff is supported, not .aif
            "",
            "invalid",
        ],
    )
    def test_from_extension_unsupported(self, extension: str):
        """test unsupported extensions return None."""
        assert AudioFormat.from_extension(extension) is None

    def test_media_types(self):
        """test media type mappings."""
        assert AudioFormat.MP3.media_type == "audio/mpeg"
        assert AudioFormat.WAV.media_type == "audio/wav"
        assert AudioFormat.M4A.media_type == "audio/mp4"
        assert AudioFormat.AIFF.media_type == "audio/aiff"
        assert AudioFormat.FLAC.media_type == "audio/flac"

    def test_extensions_with_dots(self):
        """test extension property includes dots."""
        assert AudioFormat.MP3.extension == ".mp3"
        assert AudioFormat.WAV.extension == ".wav"
        assert AudioFormat.M4A.extension == ".m4a"
        assert AudioFormat.AIFF.extension == ".aiff"
        assert AudioFormat.FLAC.extension == ".flac"

    def test_all_extensions(self):
        """test all_extensions returns complete list."""
        extensions = AudioFormat.all_extensions()
        assert ".mp3" in extensions
        assert ".wav" in extensions
        assert ".m4a" in extensions
        assert ".aiff" in extensions
        assert ".flac" in extensions
        assert len(extensions) == 5

    def test_supported_extensions_str(self):
        """test formatted string of supported extensions."""
        ext_str = AudioFormat.supported_extensions_str()
        assert ".mp3" in ext_str
        assert ".wav" in ext_str
        assert ".m4a" in ext_str
        assert ".aiff" in ext_str
        assert ".flac" in ext_str

    def test_is_web_playable(self):
        """test web playable detection - browsers can play mp3/wav/m4a natively."""
        # web-playable formats (no transcoding needed)
        assert AudioFormat.MP3.is_web_playable is True
        assert AudioFormat.WAV.is_web_playable is True
        assert AudioFormat.M4A.is_web_playable is True
        # lossless formats require transcoding for browser playback
        assert AudioFormat.AIFF.is_web_playable is False
        assert AudioFormat.FLAC.is_web_playable is False

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
            ".flac",
            ".ogg",
            ".aac",
            ".wma",
            ".aiff",
            ".aif",
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

    def test_extensions_with_dots(self):
        """test extension property includes dots."""
        assert AudioFormat.MP3.extension == ".mp3"
        assert AudioFormat.WAV.extension == ".wav"
        assert AudioFormat.M4A.extension == ".m4a"

    def test_all_extensions(self):
        """test all_extensions returns complete list."""
        extensions = AudioFormat.all_extensions()
        assert ".mp3" in extensions
        assert ".wav" in extensions
        assert ".m4a" in extensions
        assert ".aiff" not in extensions
        assert ".aif" not in extensions
        assert len(extensions) == 3

    def test_supported_extensions_str(self):
        """test formatted string of supported extensions."""
        ext_str = AudioFormat.supported_extensions_str()
        assert ".mp3" in ext_str
        assert ".wav" in ext_str
        assert ".m4a" in ext_str
        # AIFF removed due to browser compatibility issues (see PR #152)
        assert ".aiff" not in ext_str

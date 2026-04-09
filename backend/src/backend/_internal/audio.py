"""audio file type definitions."""

from enum import Enum
from typing import Self


class AudioFormat(str, Enum):
    """supported audio formats."""

    MP3 = "mp3"
    WAV = "wav"
    M4A = "m4a"
    AIFF = "aiff"
    FLAC = "flac"
    # browser MediaRecorder output formats — accepted so /record can post
    # whatever the browser produces, transcoder normalizes to mp3
    WEBM = "webm"
    OGG = "ogg"

    @property
    def extension(self) -> str:
        """get file extension with dot."""
        return f".{self.value}"

    @property
    def media_type(self) -> str:
        """get http media type."""
        media_types = {
            AudioFormat.MP3: "audio/mpeg",
            AudioFormat.WAV: "audio/wav",
            AudioFormat.M4A: "audio/mp4",
            AudioFormat.AIFF: "audio/aiff",
            AudioFormat.FLAC: "audio/flac",
            AudioFormat.WEBM: "audio/webm",
            AudioFormat.OGG: "audio/ogg",
        }
        return media_types[self]

    @property
    def is_web_playable(self) -> bool:
        """browsers can play this format natively (no transcoding needed).

        note: webm/ogg are *technically* browser-playable but we route them
        through the transcoder so the stored audio is normalized (mp3) for
        embeds, scrubbing, and downstream tools that expect mp3/wav/m4a.
        """
        return self in {
            AudioFormat.MP3,
            AudioFormat.WAV,
            AudioFormat.M4A,
            AudioFormat.FLAC,
        }

    @classmethod
    def from_extension(cls, ext: str) -> Self | None:
        """get format from file extension (with or without dot)."""
        ext = ext.lower().lstrip(".")
        # handle .aif as alias for .aiff
        if ext == "aif":
            ext = "aiff"
        for format in cls:
            if format.value == ext:
                return format
        return None

    @classmethod
    def all_extensions(cls) -> list[str]:
        """get all supported extensions with dots."""
        return [f.extension for f in cls]

    @classmethod
    def supported_extensions_str(cls) -> str:
        """get formatted string of supported extensions."""
        return ", ".join(cls.all_extensions())

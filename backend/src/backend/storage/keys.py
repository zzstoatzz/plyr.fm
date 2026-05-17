"""typed R2 keys for audio and image objects.

every R2 read/write/delete in r2.py routes through one of these two types.
the dataclass constructor validates the extension against AudioFormat /
ImageFormat and stores the raw filename extension (not a canonical /
normalized form) so a `.aif` upload reads back via `.aif`, a `.jpeg` via
`.jpeg`, etc. save and read share the same key because they share the
same type — there is no second path that can disagree.

historical context: this exists because the same save/read extension-drift
bug shipped in #332, #797, #849, #1202, and woody.fm 2026-05-16 — each
fix touched one side and missed the other. typing the key makes the bug
unrepresentable.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath

from backend._internal.audio import AudioFormat
from backend._internal.image import ImageFormat


class InvalidMediaExtension(ValueError):
    """raised when a key is constructed with an extension we don't store."""


def _strip_ext(raw: str) -> str:
    return raw.lower().lstrip(".")


@dataclass(frozen=True, slots=True)
class AudioKey:
    """R2 key for an audio object stored under `audio/<file_id>.<ext>`.

    construct via `from_filename` at upload time or `for_file` when
    rehydrating from `(file_id, file_type)` stored in the database. both
    paths validate the extension against `AudioFormat`, so an unsupported
    extension never reaches R2.
    """

    file_id: str
    extension: str

    def __post_init__(self) -> None:
        if not self.file_id:
            raise InvalidMediaExtension("file_id is required")
        if AudioFormat.from_extension(self.extension) is None:
            raise InvalidMediaExtension(
                f"unsupported audio extension: {self.extension!r} "
                f"(supported: {AudioFormat.supported_extensions_str()})"
            )

    @classmethod
    def from_filename(cls, file_id: str, filename: str) -> AudioKey:
        """build from a user-supplied filename (validates the suffix)."""
        return cls(
            file_id=file_id, extension=_strip_ext(PurePosixPath(filename).suffix)
        )

    @classmethod
    def for_file(cls, file_id: str, file_type: str) -> AudioKey:
        """build from `(file_id, file_type)` as stored in the tracks table."""
        return cls(file_id=file_id, extension=_strip_ext(file_type))

    @property
    def key(self) -> str:
        return f"audio/{self.file_id}.{self.extension}"

    @property
    def format(self) -> AudioFormat:
        # validated in __post_init__, so this can't return None
        return AudioFormat.from_extension(self.extension)  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class ImageKey:
    """R2 key for an image object stored under `images/<file_id>.<ext>`.

    image extensions are preserved as-uploaded — `.jpg` and `.jpeg` produce
    distinct keys (matching #1202's resolution). construct via
    `from_filename` at upload time or `for_file` when rehydrating.
    """

    file_id: str
    extension: str

    def __post_init__(self) -> None:
        if not self.file_id:
            raise InvalidMediaExtension("file_id is required")
        try:
            ImageFormat(self.extension)
        except ValueError as exc:
            supported = ", ".join(sorted(f.value for f in ImageFormat))
            raise InvalidMediaExtension(
                f"unsupported image extension: {self.extension!r} (supported: {supported})"
            ) from exc

    @classmethod
    def from_filename(cls, file_id: str, filename: str) -> ImageKey:
        return cls(
            file_id=file_id, extension=_strip_ext(PurePosixPath(filename).suffix)
        )

    @classmethod
    def for_file(cls, file_id: str, file_type: str) -> ImageKey:
        return cls(file_id=file_id, extension=_strip_ext(file_type))

    @property
    def key(self) -> str:
        return f"images/{self.file_id}.{self.extension}"

    @property
    def format(self) -> ImageFormat:
        return ImageFormat(self.extension)

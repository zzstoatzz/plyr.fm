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
from urllib.parse import urlsplit

from backend._internal.image import ImageFormat
from backend.utilities.audio_formats import AudioFormat


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
        """build from `(file_id, file_type)` as stored in the tracks table.

        NOTE: `Track.file_id` is only a storage key for audio *we* stored. on
        the jetstream ingest path it is `record["fileId"]` falling back to the
        rkey — a value the record's author chose, which generally addresses
        nothing in our bucket. for a row that carries an `r2_url`, that URL is
        the authoritative pointer: use `from_url` (see `for_track`).
        """
        return cls(file_id=file_id, extension=_strip_ext(file_type))

    @classmethod
    def from_url(cls, url: str) -> AudioKey | None:
        """recover the key from one of *our own* public audio URLs.

        the origin must match this deployment's configured audio bucket. a
        record's `audioUrl` is written by whoever authored the record, and a
        path lifted from a foreign origin would name one of our objects while
        claiming to describe someone else's bytes (#1778: never treat an
        uploader-controlled endpoint as our storage). returns None for a
        foreign origin, another environment's bucket, or a shape we don't
        store — callers decide whether that's a fallback or a failure.
        """
        from backend.config import settings

        bucket_url = settings.storage.r2_public_bucket_url
        if not bucket_url:
            return None
        parsed = urlsplit(url)
        ours = urlsplit(bucket_url)
        if (parsed.scheme, parsed.netloc) != (ours.scheme, ours.netloc):
            return None

        path = PurePosixPath(parsed.path)
        if path.parent.name != "audio" or not path.stem:
            return None
        try:
            return cls(file_id=path.stem, extension=_strip_ext(path.suffix))
        except InvalidMediaExtension:
            return None

    @classmethod
    def for_track(cls, *, file_id: str, file_type: str, r2_url: str | None) -> AudioKey:
        """the key that actually locates a track's audio.

        prefers the key encoded in `r2_url` — set by whoever stored the bytes —
        over `(file_id, file_type)`, which only addresses storage for uploads
        that went through us.
        """
        if r2_url and (from_url := cls.from_url(r2_url)):
            return from_url
        return cls.for_file(file_id, file_type)

    @property
    def key(self) -> str:
        return f"audio/{self.file_id}.{self.extension}"

    @property
    def format(self) -> AudioFormat:
        # validated in __post_init__, so this can't return None
        return AudioFormat.from_extension(self.extension)  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class StagedUploadKey:
    """R2 key for bytes mid-transfer, stored under `staged/<upload_id>.<ext>`.

    a resumable upload lands here part by part before anything knows its
    content hash. the worker settles it into an `AudioKey` (or a PDS blob)
    and deletes it; nothing is ever served from this prefix.
    """

    upload_id: str
    extension: str

    def __post_init__(self) -> None:
        if not self.upload_id:
            raise InvalidMediaExtension("upload_id is required")
        if AudioFormat.from_extension(self.extension) is None:
            raise InvalidMediaExtension(
                f"unsupported audio extension: {self.extension!r} "
                f"(supported: {AudioFormat.supported_extensions_str()})"
            )

    @classmethod
    def from_filename(cls, upload_id: str, filename: str) -> StagedUploadKey:
        return cls(
            upload_id=upload_id,
            extension=_strip_ext(PurePosixPath(filename).suffix),
        )

    @property
    def key(self) -> str:
        return f"staged/{self.upload_id}.{self.extension}"

    @property
    def format(self) -> AudioFormat:
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

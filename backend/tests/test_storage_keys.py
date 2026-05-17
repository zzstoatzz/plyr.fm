"""unit tests for typed R2 keys.

these guard the invariant that lets `r2.py` be drift-free: every key
construction goes through AudioKey / ImageKey, and the key string is a
single deterministic function of (file_id, extension). there is no
codepath that can produce a different key for the same logical object.
"""

from dataclasses import FrozenInstanceError

import pytest

from backend._internal.audio import AudioFormat
from backend._internal.image import ImageFormat
from backend.storage.keys import AudioKey, ImageKey, InvalidMediaExtension


class TestAudioKey:
    @pytest.mark.parametrize(
        ("file_id", "extension", "expected_key"),
        [
            ("abc123", "mp3", "audio/abc123.mp3"),
            ("abc123", "wav", "audio/abc123.wav"),
            ("abc123", "m4a", "audio/abc123.m4a"),
            ("abc123", "flac", "audio/abc123.flac"),
            ("abc123", "aiff", "audio/abc123.aiff"),
            ("abc123", "aif", "audio/abc123.aif"),  # preserved as-uploaded
            ("abc123", "webm", "audio/abc123.webm"),
            ("abc123", "ogg", "audio/abc123.ogg"),
        ],
    )
    def test_key_construction(
        self, file_id: str, extension: str, expected_key: str
    ) -> None:
        assert AudioKey(file_id=file_id, extension=extension).key == expected_key

    @pytest.mark.parametrize(
        ("file_id", "filename", "expected_extension"),
        [
            ("abc123", "song.mp3", "mp3"),
            ("abc123", "Song.MP3", "mp3"),
            ("abc123", "song.aif", "aif"),
            ("abc123", "song.aiff", "aiff"),
            ("abc123", "song.AIF", "aif"),
            ("abc123", "path/to/song.flac", "flac"),
            ("abc123", "song with spaces.wav", "wav"),
        ],
    )
    def test_from_filename(
        self, file_id: str, filename: str, expected_extension: str
    ) -> None:
        key = AudioKey.from_filename(file_id, filename)
        assert key.extension == expected_extension
        assert key.file_id == file_id

    @pytest.mark.parametrize(
        ("file_type", "expected_extension"),
        [
            ("mp3", "mp3"),
            ("MP3", "mp3"),
            (".mp3", "mp3"),
            (".MP3", "mp3"),
            ("aif", "aif"),
            ("aiff", "aiff"),
        ],
    )
    def test_for_file_normalizes_input(
        self, file_type: str, expected_extension: str
    ) -> None:
        key = AudioKey.for_file("abc123", file_type)
        assert key.extension == expected_extension

    def test_aif_and_aiff_produce_distinct_keys(self) -> None:
        """the prevention guarantee: save and read for the same upload produce
        the same key. an `.aif` upload reads back via `.aif`, NOT `.aiff`.
        woody.fm 2026-05-16 broke because save used `.aif` and read normalized
        to `.aiff`. with typed keys, save and read both call `for_file` or
        `from_filename` with the same input → same `.key`.
        """
        save_side = AudioKey.from_filename("abc123", "song.aif")
        read_side = AudioKey.for_file("abc123", "aif")
        assert save_side.key == read_side.key == "audio/abc123.aif"

        # the .aiff case stays distinct
        save_aiff = AudioKey.from_filename("def456", "song.aiff")
        read_aiff = AudioKey.for_file("def456", "aiff")
        assert save_aiff.key == read_aiff.key == "audio/def456.aiff"

    @pytest.mark.parametrize(
        "extension",
        ["mp4", "txt", "exe", "", "aifff", "MP3 "],
    )
    def test_rejects_unsupported_extension(self, extension: str) -> None:
        with pytest.raises(InvalidMediaExtension):
            AudioKey(file_id="abc123", extension=extension)

    def test_rejects_empty_file_id(self) -> None:
        with pytest.raises(InvalidMediaExtension):
            AudioKey(file_id="", extension="mp3")

    def test_format_property_resolves_aliases(self) -> None:
        """both `.aif` and `.aiff` map to AudioFormat.AIFF for media-type lookup,
        even though they produce distinct keys."""
        assert AudioKey.for_file("abc123", "aif").format is AudioFormat.AIFF
        assert AudioKey.for_file("abc123", "aiff").format is AudioFormat.AIFF
        assert AudioKey.for_file("abc123", "mp3").format is AudioFormat.MP3

    def test_frozen(self) -> None:
        """frozen=True means once constructed, the key cannot drift."""
        key = AudioKey.for_file("abc123", "mp3")
        with pytest.raises(FrozenInstanceError):
            key.extension = "wav"  # type: ignore[misc]

    def test_equality(self) -> None:
        assert AudioKey.for_file("abc123", "mp3") == AudioKey.for_file("abc123", "mp3")
        assert AudioKey.for_file("abc123", "mp3") != AudioKey.for_file("abc123", "wav")
        assert AudioKey.for_file("abc123", "mp3") != AudioKey.for_file("xyz789", "mp3")


class TestImageKey:
    @pytest.mark.parametrize(
        ("file_id", "extension", "expected_key"),
        [
            ("abc123", "jpg", "images/abc123.jpg"),
            ("abc123", "jpeg", "images/abc123.jpeg"),  # preserved distinct from .jpg
            ("abc123", "png", "images/abc123.png"),
            ("abc123", "webp", "images/abc123.webp"),
            ("abc123", "gif", "images/abc123.gif"),
        ],
    )
    def test_key_construction(
        self, file_id: str, extension: str, expected_key: str
    ) -> None:
        assert ImageKey(file_id=file_id, extension=extension).key == expected_key

    @pytest.mark.parametrize(
        ("filename", "expected_extension"),
        [
            ("cover.jpg", "jpg"),
            ("cover.JPG", "jpg"),
            ("cover.jpeg", "jpeg"),
            ("cover.JPEG", "jpeg"),
            ("cover.png", "png"),
            ("cover.webp", "webp"),
            ("cover.gif", "gif"),
        ],
    )
    def test_from_filename(self, filename: str, expected_extension: str) -> None:
        assert (
            ImageKey.from_filename("abc123", filename).extension == expected_extension
        )

    def test_jpg_and_jpeg_produce_distinct_keys(self) -> None:
        """#1202 regression: `.jpeg` uploads were stored as `images/<id>.jpeg`
        but URL builder said `.jpg`. with typed keys, both sides resolve to the
        same extension and the same key.
        """
        save_side = ImageKey.from_filename("abc123", "cover.jpeg")
        read_side = ImageKey.for_file("abc123", "jpeg")
        assert save_side.key == read_side.key == "images/abc123.jpeg"

        save_jpg = ImageKey.from_filename("def456", "cover.jpg")
        read_jpg = ImageKey.for_file("def456", "jpg")
        assert save_jpg.key == read_jpg.key == "images/def456.jpg"

    @pytest.mark.parametrize(
        "extension",
        ["mp3", "tiff", "bmp", "heic", "", "PNG "],
    )
    def test_rejects_unsupported_extension(self, extension: str) -> None:
        with pytest.raises(InvalidMediaExtension):
            ImageKey(file_id="abc123", extension=extension)

    def test_rejects_empty_file_id(self) -> None:
        with pytest.raises(InvalidMediaExtension):
            ImageKey(file_id="", extension="png")

    def test_format_property(self) -> None:
        assert ImageKey.for_file("abc", "jpg").format is ImageFormat.JPEG
        assert ImageKey.for_file("abc", "jpeg").format is ImageFormat.JPEG_ALT
        assert ImageKey.for_file("abc", "png").format is ImageFormat.PNG

    def test_frozen(self) -> None:
        key = ImageKey.for_file("abc123", "png")
        with pytest.raises(FrozenInstanceError):
            key.extension = "jpg"  # type: ignore[misc]

"""tests for image format validation."""

import pytest

from backend.models.image import ImageFormat


class TestImageFormat:
    """test ImageFormat enum functionality."""

    @pytest.mark.parametrize(
        ("filename", "expected_format"),
        [
            # jpeg (jpg)
            ("image.jpg", ImageFormat.JPEG),
            ("image.JPG", ImageFormat.JPEG),
            ("photo.jpeg", ImageFormat.JPEG),
            ("photo.JPEG", ImageFormat.JPEG),
            # png
            ("image.png", ImageFormat.PNG),
            ("image.PNG", ImageFormat.PNG),
            # webp
            ("image.webp", ImageFormat.WEBP),
            ("image.WEBP", ImageFormat.WEBP),
            # gif
            ("image.gif", ImageFormat.GIF),
            ("image.GIF", ImageFormat.GIF),
        ],
    )
    def test_from_filename_supported(self, filename: str, expected_format: ImageFormat):
        """test supported filename recognition (case-insensitive)."""
        assert ImageFormat.from_filename(filename) == expected_format

    @pytest.mark.parametrize(
        "filename",
        [
            "image.bmp",
            "image.tiff",
            "image.svg",
            "image.ico",
            "image.txt",
            "image",
            "noextension",
        ],
    )
    def test_from_filename_unsupported(self, filename: str):
        """test unsupported filenames return None."""
        assert ImageFormat.from_filename(filename) is None

    def test_media_types(self):
        """test media type mappings."""
        assert ImageFormat.JPEG.media_type == "image/jpeg"
        assert ImageFormat.PNG.media_type == "image/png"
        assert ImageFormat.WEBP.media_type == "image/webp"
        assert ImageFormat.GIF.media_type == "image/gif"

    def test_jpeg_alias(self):
        """test that both jpg and jpeg extensions map to JPEG format."""
        assert ImageFormat.from_filename("image.jpg") == ImageFormat.JPEG
        assert ImageFormat.from_filename("image.jpeg") == ImageFormat.JPEG

    def test_case_insensitive(self):
        """test that extension matching is case-insensitive."""
        assert ImageFormat.from_filename("IMAGE.JPG") == ImageFormat.JPEG
        assert ImageFormat.from_filename("Image.Png") == ImageFormat.PNG
        assert ImageFormat.from_filename("photo.WebP") == ImageFormat.WEBP

    def test_with_path(self):
        """test that filenames with paths work correctly."""
        assert ImageFormat.from_filename("/path/to/image.jpg") == ImageFormat.JPEG
        assert ImageFormat.from_filename("../images/photo.png") == ImageFormat.PNG
        assert (
            ImageFormat.from_filename("C:\\Users\\test\\pic.webp") == ImageFormat.WEBP
        )

"""tests for image format validation."""

import pytest

from backend._internal.image import ImageFormat


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

    @pytest.mark.parametrize(
        ("content_type", "expected_format"),
        [
            ("image/jpeg", ImageFormat.JPEG),
            ("image/jpg", ImageFormat.JPEG),
            ("image/png", ImageFormat.PNG),
            ("image/webp", ImageFormat.WEBP),
            ("image/gif", ImageFormat.GIF),
            # with charset
            ("image/jpeg; charset=utf-8", ImageFormat.JPEG),
            # case insensitive
            ("IMAGE/JPEG", ImageFormat.JPEG),
            ("Image/Png", ImageFormat.PNG),
        ],
    )
    def test_from_content_type_supported(
        self, content_type: str, expected_format: ImageFormat
    ):
        """test supported content type recognition."""
        assert ImageFormat.from_content_type(content_type) == expected_format

    @pytest.mark.parametrize(
        "content_type",
        [
            "image/heic",
            "image/bmp",
            "image/tiff",
            "application/octet-stream",
            "",
            None,
        ],
    )
    def test_from_content_type_unsupported(self, content_type: str | None):
        """test unsupported content types return None."""
        assert ImageFormat.from_content_type(content_type) is None

    def test_validate_and_extract_prefers_content_type(self):
        """test that content_type is preferred over filename extension.

        this is the iOS HEIC case: filename is .heic but content is jpeg.
        """
        # HEIC filename but JPEG content type -> should return JPEG
        image_format, is_valid = ImageFormat.validate_and_extract(
            "IMG_1234.HEIC", "image/jpeg"
        )
        assert is_valid is True
        assert image_format == ImageFormat.JPEG

    def test_validate_and_extract_falls_back_to_filename(self):
        """test fallback to filename when no content_type provided."""
        image_format, is_valid = ImageFormat.validate_and_extract("photo.png", None)
        assert is_valid is True
        assert image_format == ImageFormat.PNG

    def test_validate_and_extract_unsupported_both(self):
        """test unsupported format when both filename and content_type are invalid."""
        image_format, is_valid = ImageFormat.validate_and_extract(
            "image.heic", "image/heic"
        )
        assert is_valid is False
        assert image_format is None

    def test_enum_iteration_includes_jpeg_extension(self):
        """test that iterating over ImageFormat includes both jpg and jpeg.

        regression test: files uploaded as .jpeg were not found by get_url()
        because the enum only had JPEG="jpg", so iteration only checked .jpg files.
        """
        extensions = [fmt.value for fmt in ImageFormat]
        assert "jpg" in extensions
        assert "jpeg" in extensions

    def test_jpeg_alt_media_type(self):
        """test that JPEG_ALT has the same media type as JPEG."""
        assert ImageFormat.JPEG_ALT.media_type == "image/jpeg"
        assert ImageFormat.JPEG_ALT.media_type == ImageFormat.JPEG.media_type

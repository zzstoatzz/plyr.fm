"""image format handling for media storage."""

from enum import Enum


class ImageFormat(str, Enum):
    """supported image formats."""

    JPEG = "jpg"
    PNG = "png"
    WEBP = "webp"
    GIF = "gif"

    @property
    def media_type(self) -> str:
        """get HTTP media type for this format."""
        return {
            "jpg": "image/jpeg",
            "png": "image/png",
            "webp": "image/webp",
            "gif": "image/gif",
        }[self.value]

    @classmethod
    def from_filename(cls, filename: str) -> "ImageFormat | None":
        """extract image format from filename extension."""
        ext = filename.lower().split(".")[-1]
        if ext in ["jpg", "jpeg"]:
            return cls.JPEG
        elif ext in cls._value2member_map_:
            return cls(ext)
        return None

    @classmethod
    def validate_and_extract(
        cls, filename: str | None
    ) -> tuple["ImageFormat | None", bool]:
        """validate image format from filename.

        returns:
            tuple of (image_format, is_valid) where:
            - image_format is the parsed format or None
            - is_valid is True if format is supported or no filename provided

        this centralizes the pattern of checking image format validity to prevent
        UnboundLocalError bugs where image_format is conditionally assigned but
        unconditionally used.

        usage:
            image_format, is_valid = ImageFormat.validate_and_extract(filename)
            if not is_valid:
                logger.warning(f"unsupported image format: {filename}")
        """
        if not filename:
            return None, True

        image_format = cls.from_filename(filename)
        return image_format, image_format is not None

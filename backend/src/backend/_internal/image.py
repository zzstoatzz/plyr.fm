"""image format handling for media storage."""

from enum import Enum
from typing import Self


class ImageFormat(str, Enum):
    """supported image formats."""

    JPEG = "jpg"
    JPEG_ALT = "jpeg"
    PNG = "png"
    WEBP = "webp"
    GIF = "gif"

    @property
    def media_type(self) -> str:
        """get HTTP media type for this format."""
        return {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "webp": "image/webp",
            "gif": "image/gif",
        }[self.value]

    @classmethod
    def from_filename(cls, filename: str) -> Self | None:
        """extract image format from filename extension."""
        ext = filename.lower().split(".")[-1]
        if ext in ["jpg", "jpeg"]:
            return cls.JPEG
        elif ext in cls._value2member_map_:
            return cls(ext)
        return None

    @classmethod
    def from_content_type(cls, content_type: str | None) -> Self | None:
        """extract image format from MIME content type.

        this is more reliable than filename extension, especially on iOS
        where HEIC photos may be converted to JPEG but keep the .heic filename.
        """
        if not content_type:
            return None

        content_type = content_type.lower().split(";")[0].strip()
        mapping = {
            "image/jpeg": cls.JPEG,
            "image/jpg": cls.JPEG,
            "image/png": cls.PNG,
            "image/webp": cls.WEBP,
            "image/gif": cls.GIF,
        }
        return mapping.get(content_type)

    @classmethod
    def validate_and_extract(
        cls, filename: str | None, content_type: str | None = None
    ) -> tuple[Self | None, bool]:
        """validate image format from filename or content type.

        prefers content_type over filename extension when available, since
        iOS may convert HEIC to JPEG but keep the original filename.

        returns:
            tuple of (image_format, is_valid) where:
            - image_format is the parsed format or None
            - is_valid is True if format is supported or no filename provided

        this centralizes the pattern of checking image format validity to prevent
        UnboundLocalError bugs where image_format is conditionally assigned but
        unconditionally used.

        usage:
            image_format, is_valid = ImageFormat.validate_and_extract(filename, content_type)
            if not is_valid:
                logger.warning(f"unsupported image format: {filename}")
        """
        if not filename:
            return None, True

        # prefer content_type over filename - more reliable on iOS
        if content_type:
            image_format = cls.from_content_type(content_type)
            if image_format:
                return image_format, True

        # fall back to filename extension
        image_format = cls.from_filename(filename)
        return image_format, image_format is not None

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

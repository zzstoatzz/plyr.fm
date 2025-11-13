"""local filesystem storage for media files."""

from pathlib import Path
from typing import BinaryIO

import anyio
from anyio import Path as AsyncPath

from backend._internal.audio import AudioFormat
from backend.utilities.hashing import CHUNK_SIZE, hash_file_chunked


class FilesystemStorage:
    """store media files on local filesystem."""

    def __init__(self, base_path: Path | None = None):
        """initialize storage with base path."""
        self.base_path = base_path or Path("data")
        self.base_path.mkdir(parents=True, exist_ok=True)
        # ensure subdirectories exist
        (self.base_path / "audio").mkdir(exist_ok=True)
        (self.base_path / "images").mkdir(exist_ok=True)

    async def save(self, file: BinaryIO, filename: str) -> str:
        """save media file using streaming write.

        uses chunked hashing and async file I/O for constant
        memory usage regardless of file size.

        supports both audio and image files.
        """
        # compute hash in chunks (constant memory)
        file_id = hash_file_chunked(file)[:16]

        # determine file extension and type
        ext = Path(filename).suffix.lower()

        # try audio format first
        audio_format = AudioFormat.from_extension(ext)
        if audio_format:
            file_path = self.base_path / "audio" / f"{file_id}{ext}"
        else:
            # try image format
            from backend._internal.image import ImageFormat

            image_format = ImageFormat.from_filename(filename)
            if image_format:
                file_path = self.base_path / "images" / f"{file_id}{ext}"
            else:
                raise ValueError(
                    f"unsupported file type: {ext}. "
                    f"supported audio: {AudioFormat.supported_extensions_str()}, "
                    f"supported image: jpg, jpeg, png, webp, gif"
                )

        # write file using async I/O in chunks (constant memory, non-blocking)
        # file pointer already reset by hash_file_chunked
        async with await anyio.open_file(file_path, "wb") as dest:
            while True:
                chunk = file.read(CHUNK_SIZE)
                if not chunk:
                    break
                await dest.write(chunk)

        return file_id

    def get_path(self, file_id: str) -> Path | None:
        """get path to media file by id."""
        # check for all supported audio formats
        for audio_format in AudioFormat:
            file_path = self.base_path / "audio" / f"{file_id}{audio_format.extension}"
            if file_path.exists():
                return file_path

        # check for all supported image formats
        from backend._internal.image import ImageFormat

        for image_format in ImageFormat:
            file_path = self.base_path / "images" / f"{file_id}.{image_format.value}"
            if file_path.exists():
                return file_path

        return None

    async def delete(self, file_id: str, file_type: str | None = None) -> bool:
        """delete media file by id using async file operations.

        args:
            file_id: the file identifier
            file_type: optional file extension (without dot) to delete exact file.
                      if provided, deletes audio/{file_id}.{file_type} directly.
                      if None, falls back to trying all formats (legacy/images).
        """
        # if file_type is provided, delete the exact file
        if file_type:
            audio_format = AudioFormat.from_extension(f".{file_type.lower()}")
            if audio_format:
                file_path = (
                    self.base_path / "audio" / f"{file_id}{audio_format.extension}"
                )
                async_path = AsyncPath(file_path)
                if await async_path.exists():
                    await async_path.unlink()
                    return True
                return False

        # fallback: try audio formats (for legacy rows or when file_type is None)
        for audio_format in AudioFormat:
            file_path = self.base_path / "audio" / f"{file_id}{audio_format.extension}"
            async_path = AsyncPath(file_path)
            if await async_path.exists():
                await async_path.unlink()
                return True

        # try image formats
        from backend._internal.image import ImageFormat

        for image_format in ImageFormat:
            file_path = self.base_path / "images" / f"{file_id}.{image_format.value}"
            async_path = AsyncPath(file_path)
            if await async_path.exists():
                await async_path.unlink()
                return True

        return False


storage = FilesystemStorage()

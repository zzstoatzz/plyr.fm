"""local filesystem storage for audio files."""

import shutil
from pathlib import Path
from typing import BinaryIO

from backend.models import AudioFormat
from backend.utilities.hashing import CHUNK_SIZE, hash_file_chunked


class FilesystemStorage:
    """store audio files on local filesystem."""

    def __init__(self, base_path: Path | None = None):
        """initialize storage with base path."""
        self.base_path = base_path or Path("data/audio")
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save(self, file: BinaryIO, filename: str) -> str:
        """save audio file using streaming write.

        uses chunked hashing and shutil.copyfileobj for constant
        memory usage regardless of file size.
        """
        # compute hash in chunks (constant memory)
        file_id = hash_file_chunked(file)[:16]

        # determine file extension
        ext = Path(filename).suffix.lower()
        audio_format = AudioFormat.from_extension(ext)
        if not audio_format:
            raise ValueError(
                f"unsupported file type: {ext}. "
                f"supported: {AudioFormat.supported_extensions_str()}"
            )

        # stream copy to disk (constant memory)
        # file pointer already reset by hash_file_chunked
        file_path = self.base_path / f"{file_id}{ext}"
        with open(file_path, "wb") as dest:
            shutil.copyfileobj(file, dest, length=CHUNK_SIZE)

        return file_id

    def get_path(self, file_id: str) -> Path | None:
        """get path to audio file by id."""
        # check for all supported formats
        for audio_format in AudioFormat:
            file_path = self.base_path / f"{file_id}{audio_format.extension}"
            if file_path.exists():
                return file_path
        return None

    def delete(self, file_id: str) -> bool:
        """delete audio file by id."""
        for audio_format in AudioFormat:
            file_path = self.base_path / f"{file_id}{audio_format.extension}"
            if file_path.exists():
                file_path.unlink()
                return True
        return False


storage = FilesystemStorage()

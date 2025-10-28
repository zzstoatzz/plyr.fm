"""local filesystem storage for audio files."""

import hashlib
from pathlib import Path
from typing import BinaryIO

from relay.models import AudioFormat


class FilesystemStorage:
    """store audio files on local filesystem."""

    def __init__(self, base_path: Path | None = None):
        """initialize storage with base path."""
        self.base_path = base_path or Path("data/audio")
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save(self, file: BinaryIO, filename: str) -> str:
        """save audio file and return file id."""
        # read file content
        content = file.read()
        
        # generate file id from content hash
        file_id = hashlib.sha256(content).hexdigest()[:16]
        
        # determine file extension
        ext = Path(filename).suffix.lower()
        audio_format = AudioFormat.from_extension(ext)
        if not audio_format:
            raise ValueError(
                f"unsupported file type: {ext}. "
                f"supported: {AudioFormat.supported_extensions_str()}"
            )
        
        # save file
        file_path = self.base_path / f"{file_id}{ext}"
        file_path.write_bytes(content)
        
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

"""storage implementations."""

from backend.config import settings

if settings.storage.backend == "r2":
    from backend.storage.r2 import R2Storage

    storage = R2Storage()
else:
    from backend.storage.filesystem import FilesystemStorage

    storage = FilesystemStorage()

__all__ = ["storage"]

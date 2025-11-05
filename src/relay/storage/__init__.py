"""storage implementations."""

from relay.config import settings

if settings.storage.backend == "r2":
    from relay.storage.r2 import R2Storage

    storage = R2Storage()
else:
    from relay.storage.filesystem import FilesystemStorage

    storage = FilesystemStorage()

__all__ = ["storage"]

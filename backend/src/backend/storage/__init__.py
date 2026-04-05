"""storage implementations."""

from typing import TYPE_CHECKING

from typing import Any

from backend.storage.protocol import StorageProtocol

_storage: Any = None


def _get_storage():
    """lazily initialize storage on first access."""
    global _storage
    if _storage is None:
        from backend.storage.r2 import R2Storage

        _storage = R2Storage()
    return _storage


# expose as module-level attribute for backwards compatibility
class _StorageProxy:
    """proxy that lazily initializes storage."""

    def __getattr__(self, name: str):
        return getattr(_get_storage(), name)


if TYPE_CHECKING:
    storage: StorageProtocol
else:
    storage = _StorageProxy()

__all__ = ["StorageProtocol", "storage"]

"""storage implementations."""

from backend.storage.r2 import R2Storage

storage = R2Storage()

__all__ = ["storage"]

"""subsonic-compatible API surface (/rest/*)."""

from backend.api.subsonic import endpoints as endpoints
from backend.api.subsonic.router import router

__all__ = ["router"]

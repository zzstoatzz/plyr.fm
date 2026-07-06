"""subsonic-compatible API surface (/rest/* plus navidrome-native compat)."""

from backend.api.subsonic import endpoints as endpoints
from backend.api.subsonic import browsing as browsing
from backend.api.subsonic import (
    fallback as fallback,
)  # must import last: catch-all route
from backend.api.subsonic.compat import router as compat_router
from backend.api.subsonic.router import router

__all__ = ["compat_router", "router"]

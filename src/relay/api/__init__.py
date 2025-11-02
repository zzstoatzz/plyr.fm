"""api routers."""

from relay.api.artists import router as artists_router
from relay.api.audio import router as audio_router
from relay.api.auth import router as auth_router
from relay.api.preferences import router as preferences_router
from relay.api.search import router as search_router
from relay.api.tracks import router as tracks_router

__all__ = [
    "artists_router",
    "audio_router",
    "auth_router",
    "preferences_router",
    "search_router",
    "tracks_router",
]

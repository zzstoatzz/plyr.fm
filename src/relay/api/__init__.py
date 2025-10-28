"""api routers."""

from relay.api.audio import router as audio_router
from relay.api.auth import router as auth_router
from relay.api.tracks import router as tracks_router

__all__ = ["audio_router", "auth_router", "tracks_router"]

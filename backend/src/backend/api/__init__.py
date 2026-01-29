"""api routers."""

from backend.api.account import router as account_router
from backend.api.artists import router as artists_router
from backend.api.audio import router as audio_router
from backend.api.auth import router as auth_router
from backend.api.exports import router as exports_router
from backend.api.moderation import router as moderation_router
from backend.api.now_playing import router as now_playing_router
from backend.api.oembed import router as oembed_router
from backend.api.pds_backfill import router as pds_backfill_router
from backend.api.preferences import router as preferences_router
from backend.api.queue import router as queue_router
from backend.api.search import router as search_router
from backend.api.stats import router as stats_router
from backend.api.tracks import router as tracks_router
from backend.api.users import router as users_router

__all__ = [
    "account_router",
    "artists_router",
    "audio_router",
    "auth_router",
    "exports_router",
    "moderation_router",
    "now_playing_router",
    "oembed_router",
    "pds_backfill_router",
    "preferences_router",
    "queue_router",
    "search_router",
    "stats_router",
    "tracks_router",
    "users_router",
]

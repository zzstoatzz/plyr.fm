"""Albums API package that exposes the FastAPI router."""

from .router import router

# Re-export cache utilities used by other modules
from .cache import (
    ALBUM_CACHE_PREFIX,
    ALBUM_CACHE_TTL_SECONDS,
    _album_cache_key,
    invalidate_album_cache,
    invalidate_album_cache_by_id,
)

# Re-export schemas and endpoint functions used by tests
from .listing import list_artist_albums
from .schemas import AlbumMetadata, AlbumResponse

# Import route modules to register handlers on the shared router.
# Static path (GET /) imported first.
from . import listing as _listing  # /, /{handle}, /{handle}/{slug}
from . import (
    mutations as _mutations,
)  # POST /, /{id}/cover, /{id}/finalize, PATCH, DELETE

__all__ = [
    "ALBUM_CACHE_PREFIX",
    "ALBUM_CACHE_TTL_SECONDS",
    "AlbumMetadata",
    "AlbumResponse",
    "_album_cache_key",
    "invalidate_album_cache",
    "invalidate_album_cache_by_id",
    "list_artist_albums",
    "router",
]

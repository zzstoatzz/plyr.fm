"""Lists API package that exposes the FastAPI router."""

from .router import router

# Import route modules to register handlers on the shared router.
# Static paths first, then wildcard paths.
from . import reorder as _reorder  # /liked/reorder, /{rkey}/reorder
from . import resolver as _resolver  # /by-uri
from . import playlists as _playlists  # /playlists, /playlists/{id}, ...

__all__ = ["router"]

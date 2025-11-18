"""Track API package that exposes the FastAPI router."""

from .router import router

# Import route modules to register handlers on the shared router.
from . import listing as _listing
from . import likes as _likes
from . import mutations as _mutations
from . import playback as _playback
from . import uploads as _uploads

__all__ = ["router"]

"""Track API package that exposes the FastAPI router."""

from .router import router

# Import route modules to register handlers on the shared router.
# IMPORTANT: Order matters! Static paths (/tags, /liked, /me) must be imported
# BEFORE modules with wildcard paths (/{track_id}) to ensure correct routing.
from . import listing as _listing  # /, /me, /me/broken
from . import tags as _tags  # /tags
from . import likes as _likes  # /liked, /{track_id}/like, /{track_id}/likes
from . import uploads as _uploads  # /, /uploads/{upload_id}/progress
from . import comments as _comments  # /{track_id}/comments, /comments/{comment_id}
from . import mutations as _mutations  # /{track_id}, /{track_id}/restore-record
from . import playback as _playback  # /{track_id}, /{track_id}/play

__all__ = ["router"]

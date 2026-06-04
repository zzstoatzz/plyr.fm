"""Radio API package that exposes the FastAPI router.

Radio carries a fair amount of idiosyncrasy (deterministic seeds, airtime caps,
per-station lenses) that we deliberately keep walled off in this package rather
than spread across the rest of the API.
"""

from backend.api.radio.router import router

# Import route module to register handlers on the shared router.
from backend.api.radio import state as _state

__all__ = ["router"]

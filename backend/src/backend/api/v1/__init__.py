"""v1 public API.

versioned API for third-party integrations.
"""

from fastapi import APIRouter

from backend.api.v1.api_keys import router as api_keys_router
from backend.api.v1.tracks import router as tracks_router

router = APIRouter(prefix="/v1", tags=["v1"])

# mount sub-routers
router.include_router(tracks_router)
router.include_router(api_keys_router)

__all__ = ["router"]

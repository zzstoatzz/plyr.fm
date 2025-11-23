"""shared FastAPI router for track endpoints."""

from fastapi import APIRouter

router = APIRouter(prefix="/tracks", tags=["tracks"])

__all__ = ["router"]

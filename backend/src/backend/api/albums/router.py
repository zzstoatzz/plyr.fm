"""shared FastAPI router for album endpoints."""

from fastapi import APIRouter

router = APIRouter(prefix="/albums", tags=["albums"])

__all__ = ["router"]

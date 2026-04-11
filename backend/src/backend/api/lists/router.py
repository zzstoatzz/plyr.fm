"""shared FastAPI router for list endpoints."""

from fastapi import APIRouter

router = APIRouter(prefix="/lists", tags=["lists"])

__all__ = ["router"]

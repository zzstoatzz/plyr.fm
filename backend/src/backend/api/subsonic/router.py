from fastapi import APIRouter

router = APIRouter(prefix="/rest", tags=["subsonic"])

__all__ = ["router"]

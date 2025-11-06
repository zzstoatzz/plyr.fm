"""search endpoints for relay."""

from fastapi import APIRouter, Query

from backend.atproto.handles import search_handles

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/handles")
async def search_atproto_handles(
    q: str = Query(..., min_length=2, description="search query (handle prefix)"),
    limit: int = Query(10, ge=1, le=25, description="max results"),
) -> dict:
    """search for ATProto handles by prefix.

    returns list of {did, handle, display_name, avatar_url}
    """
    results = await search_handles(q, limit=limit)
    return {"results": results}

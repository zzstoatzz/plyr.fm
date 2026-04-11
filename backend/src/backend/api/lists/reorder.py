"""reorder endpoints for list items."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto.records import update_list_record
from backend.api.albums import invalidate_album_cache
from backend.models import Album, UserPreferences, get_db

from .router import router
from .schemas import ReorderRequest, ReorderResponse


@router.put("/liked/reorder")
async def reorder_liked_list(
    body: ReorderRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> ReorderResponse:
    """reorder items in the user's liked tracks list.

    the items array order becomes the new display order.
    only the list owner can reorder their own list.
    """
    # get the user's liked list URI from preferences
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == session.did)
    )
    prefs = prefs_result.scalar_one_or_none()

    if not prefs or not prefs.liked_list_uri:
        raise HTTPException(
            status_code=404,
            detail="liked list not found - try liking a track first",
        )

    # update the list record with new item order
    # (update_list_record → make_pds_request handles token refresh internally)
    try:
        uri, cid = await update_list_record(
            auth_session=session,
            list_uri=prefs.liked_list_uri,
            items=body.items,
            list_type="liked",
        )
        return ReorderResponse(uri=uri, cid=cid)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to reorder list: {e}"
        ) from e


@router.put("/{rkey}/reorder")
async def reorder_list(
    rkey: str,
    body: ReorderRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> ReorderResponse:
    """reorder items in a list by rkey. items array order = new display order."""
    from backend.config import settings

    # construct the full AT URI
    list_uri = f"at://{session.did}/{settings.atproto.list_collection}/{rkey}"

    # update the list record with new item order
    # (update_list_record → make_pds_request handles token refresh internally)
    try:
        uri, cid = await update_list_record(
            auth_session=session,
            list_uri=list_uri,
            items=body.items,
        )

        # invalidate album cache if this list belongs to an album
        result = await db.execute(
            select(Album).where(Album.atproto_record_uri == list_uri)
        )
        if album := result.scalar_one_or_none():
            await invalidate_album_cache(session.handle, album.slug)

        return ReorderResponse(uri=uri, cid=cid)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to reorder list: {e}"
        ) from e

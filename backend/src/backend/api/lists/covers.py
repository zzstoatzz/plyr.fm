"""playlist cover art endpoints — upload and remove.

an explicit cover always wins on clients; removing it lets the composite
cover (cached member-track artwork, see `previews.py`) take over.
"""

import contextlib
import logging

from fastapi import Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.image_uploads import COVER_EXTENSIONS, process_image_upload
from backend.models import Artist, Playlist, get_db
from backend.storage import storage

from .playlists import _assert_can_mutate, _build_playlist_response
from .router import router
from .schemas import PlaylistResponse

logger = logging.getLogger(__name__)


async def _get_owned_playlist(
    db: AsyncSession, playlist_id: str, session: AuthSession
) -> tuple[Playlist, Artist]:
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row
    _assert_can_mutate(session, playlist)
    return playlist, artist


async def _delete_cover_object_best_effort(playlist: Playlist) -> None:
    if not playlist.image_id:
        return
    with contextlib.suppress(Exception):
        if playlist.image_url:
            await storage.delete_image(playlist.image_id, playlist.image_url)
        else:
            await storage.delete(playlist.image_id)


@router.post("/playlists/{playlist_id}/cover")
async def upload_playlist_cover(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
    image: UploadFile = File(...),
) -> dict[str, str | None]:
    """upload cover art for a playlist (requires authentication).

    accepts jpg, jpeg, png, webp images up to 20MB.
    """
    playlist, _artist = await _get_owned_playlist(db, playlist_id, session)

    try:
        uploaded = await process_image_upload(
            image, "playlist", allowed_extensions=COVER_EXTENSIONS
        )

        # delete old image if exists (prevent R2 object leaks)
        if playlist.image_id != uploaded.image_id:
            await _delete_cover_object_best_effort(playlist)

        playlist.image_id = uploaded.image_id
        playlist.image_url = uploaded.image_url
        playlist.thumbnail_url = uploaded.thumbnail_url
        await db.commit()

        return {
            "image_url": uploaded.image_url,
            "image_id": uploaded.image_id,
            "thumbnail_url": uploaded.thumbnail_url,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"failed to upload playlist cover: {e}")
        raise HTTPException(
            status_code=500, detail="failed to upload cover image"
        ) from e


@router.delete("/playlists/{playlist_id}/cover", response_model=PlaylistResponse)
async def remove_playlist_cover(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """remove a playlist's explicit cover art.

    the composite cover (member-track artwork) takes over on clients once
    `image_url` is null. deleting the R2 object is best-effort — the
    user-facing state is already correct once the row is cleared.
    """
    playlist, artist = await _get_owned_playlist(db, playlist_id, session)

    if not playlist.image_id and not playlist.image_url:
        raise HTTPException(status_code=400, detail="playlist has no cover")

    await _delete_cover_object_best_effort(playlist)

    playlist.image_id = None
    playlist.image_url = None
    playlist.thumbnail_url = None
    await db.commit()
    await db.refresh(playlist)

    return _build_playlist_response(playlist, artist.handle)

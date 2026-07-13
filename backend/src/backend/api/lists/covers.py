"""playlist cover art endpoints — upload and remove.

an explicit cover always wins on clients; removing it lets the composite
cover (cached member-track artwork, see `previews.py`) take over.
"""

import asyncio
import contextlib
import logging
from io import BytesIO

import anyio.to_thread
import httpx
from fastapi import Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import RedirectResponse
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session, require_auth
from backend._internal.image_uploads import COVER_EXTENSIONS, process_image_upload
from backend.models import Artist, Playlist, Track, get_db
from backend.storage import storage

from .playlists import _assert_can_mutate, _build_playlist_response, _can_view
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


OG_COVER_TILE = 300
"""side length of each mosaic tile; the composed image is 600x600."""

OG_COVER_CACHE_SECONDS = 3600


def _compose_og_mosaic(tiles: list[bytes]) -> bytes:
    """2x2 grid of the first four artworks, PNG-encoded."""
    canvas = Image.new("RGB", (OG_COVER_TILE * 2, OG_COVER_TILE * 2))
    for i, data in enumerate(tiles[:4]):
        img = Image.open(BytesIO(data))
        img = ImageOps.exif_transpose(img) or img
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img = ImageOps.fit(
            img, (OG_COVER_TILE, OG_COVER_TILE), Image.Resampling.LANCZOS
        )
        canvas.paste(img, ((i % 2) * OG_COVER_TILE, (i // 2) * OG_COVER_TILE))
    buf = BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


async def _fetch_image(client: httpx.AsyncClient, url: str) -> bytes | None:
    try:
        response = await client.get(url, follow_redirects=True, timeout=10.0)
        response.raise_for_status()
        return response.content
    except Exception as e:
        logger.warning("failed to fetch artwork %s for og cover: %s", url, e)
        return None


async def _full_size_previews(db: AsyncSession, previews: list[str]) -> list[str]:
    """swap cached thumbnail URLs (96px) for the tracks' full-size artwork.

    entries that don't resolve (e.g. the cache stored `image_url` because the
    track had no thumbnail) pass through unchanged.
    """
    result = await db.execute(
        select(Track.thumbnail_url, Track.image_url).where(
            Track.thumbnail_url.in_(previews)
        )
    )
    full_by_thumb = {thumb: image for thumb, image in result.all() if image}
    return [full_by_thumb.get(url, url) for url in previews]


@router.get("/playlists/{playlist_id}/og-cover")
async def playlist_og_cover(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    session: AuthSession | None = Depends(get_optional_session),
) -> Response:
    """the playlist's cover as one fetchable image, for link previews.

    scrapers can't run the client-side composite, so this serves whatever
    the site shows: 307 to the explicit cover when set, a composed 2x2 PNG
    at 4+ distinct member artworks, 307 to the first artwork below that,
    404 when there's nothing to show.
    """
    result = await db.execute(select(Playlist).where(Playlist.id == playlist_id))
    playlist = result.scalar_one_or_none()

    if not playlist or not _can_view(session.did if session else None, playlist):
        raise HTTPException(status_code=404, detail="playlist not found")

    if playlist.image_url:
        return RedirectResponse(playlist.image_url, status_code=307)

    previews = playlist.preview_thumbnails or []
    if not previews:
        raise HTTPException(status_code=404, detail="playlist has no artwork")

    urls = await _full_size_previews(db, previews)
    if len(urls) < 4:
        return RedirectResponse(urls[0], status_code=307)

    async with httpx.AsyncClient() as client:
        fetched = await asyncio.gather(*(_fetch_image(client, url) for url in urls))
    tiles = [data for data in fetched if data]
    if len(tiles) < 4:
        return RedirectResponse(urls[0], status_code=307)

    png = await anyio.to_thread.run_sync(_compose_og_mosaic, tiles)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={OG_COVER_CACHE_SECONDS}"},
    )


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

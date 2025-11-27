"""albums api endpoints."""

import asyncio
import contextlib
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_artist_profile
from backend._internal.auth import get_session
from backend.models import Album, Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.storage import storage
from backend.utilities.aggregations import get_comment_counts, get_like_counts
from backend.utilities.hashing import CHUNK_SIZE

router = APIRouter(prefix="/albums", tags=["albums"])


# Pydantic models defined first to avoid forward reference issues
class AlbumMetadata(BaseModel):
    """album metadata response."""

    id: str
    title: str
    slug: str
    description: str | None = None
    artist: str
    artist_handle: str
    track_count: int
    total_plays: int
    image_url: str | None


class AlbumResponse(BaseModel):
    """album detail response with tracks."""

    metadata: AlbumMetadata
    tracks: list[dict]


class AlbumListItem(BaseModel):
    """minimal album info for listing."""

    id: str
    title: str
    slug: str
    artist: str
    artist_handle: str
    track_count: int
    total_plays: int
    image_url: str | None


class ArtistAlbumListItem(BaseModel):
    """album info for a specific artist (used on artist pages)."""

    id: str
    title: str
    slug: str
    track_count: int
    total_plays: int
    image_url: str | None


class AlbumCreatePayload(BaseModel):
    title: str
    slug: str | None = None
    description: str | None = None


class AlbumUpdatePayload(BaseModel):
    title: str | None = None
    slug: str | None = None
    description: str | None = None


# Helper functions
async def _album_stats(db: AsyncSession, album_id: str) -> tuple[int, int]:
    result = await db.execute(
        select(
            func.count(Track.id),
            func.coalesce(func.sum(Track.play_count), 0),
        ).where(Track.album_id == album_id)
    )
    track_count, total_plays = result.one()
    return int(track_count or 0), int(total_plays or 0)


async def _album_image_url(album: Album, artist: Artist | None = None) -> str | None:
    if album.image_url:
        return album.image_url
    if album.image_id:
        return await album.get_image_url()
    if artist and artist.avatar_url:
        return artist.avatar_url
    return None


async def _album_list_item(
    album: Album,
    artist: Artist,
    track_count: int,
    total_plays: int,
) -> AlbumListItem:
    image_url = await _album_image_url(album, artist)
    return AlbumListItem(
        id=album.id,
        title=album.title,
        slug=album.slug,
        artist=artist.display_name,
        artist_handle=artist.handle,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
    )


async def _artist_album_summary(
    album: Album,
    artist: Artist,
    track_count: int,
    total_plays: int,
) -> ArtistAlbumListItem:
    image_url = await _album_image_url(album, artist)
    return ArtistAlbumListItem(
        id=album.id,
        title=album.title,
        slug=album.slug,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
    )


async def _album_metadata(
    album: Album,
    artist: Artist,
    track_count: int,
    total_plays: int,
) -> AlbumMetadata:
    image_url = await _album_image_url(album, artist)
    return AlbumMetadata(
        id=album.id,
        title=album.title,
        slug=album.slug,
        description=album.description,
        artist=artist.display_name,
        artist_handle=artist.handle,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
    )


@router.get("/")
async def list_albums(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, list[AlbumListItem]]:
    """list all albums with basic metadata."""
    stmt = (
        select(
            Album,
            Artist,
            func.count(Track.id).label("track_count"),
            func.coalesce(func.sum(Track.play_count), 0).label("total_plays"),
        )
        .join(Artist, Album.artist_did == Artist.did)
        .outerjoin(Track, Track.album_id == Album.id)
        .group_by(Album.id, Artist.did)
        .order_by(func.lower(Album.title))
    )

    result = await db.execute(stmt)
    albums: list[AlbumListItem] = []
    for album, artist, track_count, total_plays in result:
        albums.append(
            await _album_list_item(
                album,
                artist,
                int(track_count or 0),
                int(total_plays or 0),
            )
        )

    return {"albums": albums}


@router.get("/{handle}")
async def list_artist_albums(
    handle: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, list[ArtistAlbumListItem]]:
    """list albums for a specific artist."""
    artist_result = await db.execute(select(Artist).where(Artist.handle == handle))
    artist = artist_result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=404, detail="artist not found")

    stmt = (
        select(
            Album,
            func.count(Track.id).label("track_count"),
            func.coalesce(func.sum(Track.play_count), 0).label("total_plays"),
        )
        .outerjoin(Track, Track.album_id == Album.id)
        .where(Album.artist_did == artist.did)
        .group_by(Album.id)
        .order_by(func.lower(Album.title))
    )
    result = await db.execute(stmt)

    album_items: list[ArtistAlbumListItem] = []
    for album, track_count, total_plays in result:
        album_items.append(
            await _artist_album_summary(
                album,
                artist,
                int(track_count or 0),
                int(total_plays or 0),
            )
        )

    return {"albums": album_items}


@router.get("/{handle}/{slug}")
async def get_album(
    handle: str,
    slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> AlbumResponse:
    """get album details with all tracks for a specific artist."""
    # look up artist + album
    album_result = await db.execute(
        select(Album, Artist)
        .join(Artist, Album.artist_did == Artist.did)
        .where(Artist.handle == handle, Album.slug == slug)
    )
    row = album_result.first()
    if not row:
        raise HTTPException(status_code=404, detail="album not found")

    album, artist = row

    # batch fetch like counts
    track_stmt = (
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.album_id == album.id)
        .order_by(Track.created_at.asc())
    )
    track_result = await db.execute(track_stmt)
    tracks = track_result.scalars().all()
    track_ids = [track.id for track in tracks]
    if track_ids:
        like_counts, comment_counts = await asyncio.gather(
            get_like_counts(db, track_ids),
            get_comment_counts(db, track_ids),
        )
    else:
        like_counts, comment_counts = {}, {}

    # get authenticated user's likes for this album's tracks only
    liked_track_ids: set[int] | None = None
    session_id = session_id_cookie or request.headers.get("authorization", "").replace(
        "Bearer ", ""
    )
    if session_id and (auth_session := await get_session(session_id)):
        if track_ids:
            liked_result = await db.execute(
                select(TrackLike.track_id).where(
                    TrackLike.user_did == auth_session.did,
                    TrackLike.track_id.in_(track_ids),
                )
            )
            liked_track_ids = set(liked_result.scalars().all())

    # ensure PDS URL cached
    pds_cache: dict[str, str | None] = {}
    if artist.pds_url:
        pds_cache[artist.did] = artist.pds_url
    else:
        from atproto_identity.did.resolver import AsyncDidResolver

        resolver = AsyncDidResolver()
        try:
            atproto_data = await resolver.resolve_atproto_data(artist.did)
            pds_cache[artist.did] = atproto_data.pds
            artist.pds_url = atproto_data.pds
            db.add(artist)
            await db.commit()
        except Exception:
            pds_cache[artist.did] = None

    # build track responses
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track,
                pds_cache.get(track.artist_did),
                liked_track_ids,
                like_counts,
                comment_counts,
            )
            for track in tracks
        ]
    )

    total_plays = sum(t.play_count for t in tracks)
    metadata = await _album_metadata(album, artist, len(tracks), total_plays)

    return AlbumResponse(
        metadata=metadata,
        tracks=[t.model_dump(mode="json") for t in track_responses],
    )


@router.post("/{album_id}/cover")
async def upload_album_cover(
    album_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
    image: UploadFile = File(...),
) -> dict[str, str | None]:
    """upload cover art for an album (requires authentication)."""
    # verify album exists and belongs to the authenticated artist
    result = await db.execute(select(Album).where(Album.id == album_id))
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only upload cover art for your own albums"
        )

    if not image.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    # validate it's an image by extension (basic check)
    ext = Path(image.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported image type: {ext}. supported: .jpg, .jpeg, .png, .webp",
        )

    # read image data (enforcing size limit)
    try:
        max_image_size = 20 * 1024 * 1024  # 20MB max
        image_data = bytearray()

        while chunk := await image.read(CHUNK_SIZE):
            if len(image_data) + len(chunk) > max_image_size:
                raise HTTPException(
                    status_code=413,
                    detail="image too large (max 20MB)",
                )
            image_data.extend(chunk)

        image_obj = BytesIO(image_data)
        # save returns the file_id (hash)
        image_id = await storage.save(image_obj, image.filename)

        # construct R2 URL directly (images are stored under images/ prefix)
        image_url = f"{storage.public_image_bucket_url}/images/{image_id}{ext}"

        # delete old image if exists (prevent R2 object leaks)
        if album.image_id:
            with contextlib.suppress(Exception):
                await storage.delete(album.image_id)

        # update album with new image
        album.image_id = image_id
        album.image_url = image_url
        await db.commit()

        return {"image_url": image_url, "image_id": image_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to upload image: {e!s}"
        ) from e

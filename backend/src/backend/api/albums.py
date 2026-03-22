"""albums api endpoints."""

import asyncio
import contextlib
import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session, require_artist_profile
from backend._internal.image_uploads import COVER_EXTENSIONS, process_image_upload
from backend.models import Album, Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.storage import storage
from backend.utilities.aggregations import (
    get_comment_counts,
    get_like_counts,
    get_track_tags,
)
from backend.utilities.redis import get_async_redis_client
from backend.utilities.slugs import slugify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/albums", tags=["albums"])

ALBUM_CACHE_PREFIX = "plyr:album:"
ALBUM_CACHE_TTL_SECONDS = 300  # 5 minutes


def _album_cache_key(handle: str, slug: str) -> str:
    return f"{ALBUM_CACHE_PREFIX}{handle}/{slug}"


async def invalidate_album_cache(handle: str, slug: str) -> None:
    """delete cached album response. fails silently."""
    try:
        redis = get_async_redis_client()
        await redis.delete(_album_cache_key(handle, slug))
    except Exception:
        logger.debug("failed to invalidate album cache for %s/%s", handle, slug)


async def invalidate_album_cache_by_id(db: AsyncSession, album_id: str) -> None:
    """look up album handle+slug and invalidate cache. fails silently."""
    try:
        result = await db.execute(
            select(Album.slug, Artist.handle)
            .join(Artist, Album.artist_did == Artist.did)
            .where(Album.id == album_id)
        )
        if row := result.first():
            slug, handle = row
            await invalidate_album_cache(handle, slug)
    except Exception:
        logger.debug("failed to invalidate album cache by id %s", album_id)


# Pydantic models defined first to avoid forward reference issues
class AlbumMetadata(BaseModel):
    """album metadata response."""

    id: str
    title: str
    slug: str
    description: str | None = None
    artist: str
    artist_handle: str
    artist_did: str
    track_count: int
    total_plays: int
    image_url: str | None
    list_uri: str | None = None  # ATProto list record URI for reordering


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


class RemoveTrackFromAlbumResponse(BaseModel):
    """response for removing a track from an album."""

    removed: bool = True
    track_id: int


class DeleteAlbumResponse(BaseModel):
    """response for deleting an album."""

    deleted: bool = True
    cascade: bool


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
        artist_did=artist.did,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
        list_uri=album.atproto_record_uri,
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
    session: AuthSession | None = Depends(get_optional_session),
) -> AlbumResponse:
    """get album details with tracks (ordered by ATProto list record or created_at)."""
    # check Redis cache first
    cache_key = _album_cache_key(handle, slug)
    try:
        redis = get_async_redis_client()
        if cached := await redis.get(cache_key):
            return AlbumResponse.model_validate_json(cached)
    except Exception:
        logger.debug("album cache read failed for %s/%s", handle, slug)

    from backend._internal.atproto.records import get_record_public_resilient

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

    pds_cache: dict[str, str | None] = {artist.did: artist.pds_url}

    # fetch all tracks for this album
    track_stmt = (
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.album_id == album.id)
    )
    track_result = await db.execute(track_stmt)
    all_tracks = list(track_result.scalars().all())

    # determine track order: use ATProto list record if available
    ordered_tracks: list[Track] = []
    if album.atproto_record_uri:
        try:
            record_data, resolved_pds_url = await get_record_public_resilient(
                record_uri=album.atproto_record_uri,
                pds_url=artist.pds_url,
            )
            if resolved_pds_url:
                artist.pds_url = resolved_pds_url
                pds_cache[artist.did] = resolved_pds_url
                db.add(artist)
                await db.commit()

            items = record_data.get("value", {}).get("items", [])
            track_uris = [item.get("subject", {}).get("uri") for item in items]
            track_uris = [uri for uri in track_uris if uri]

            # build uri -> track map
            track_by_uri = {t.atproto_record_uri: t for t in all_tracks}

            # order tracks by ATProto list, append any not in list at end
            seen_ids = set()
            for uri in track_uris:
                if uri in track_by_uri:
                    track = track_by_uri[uri]
                    ordered_tracks.append(track)
                    seen_ids.add(track.id)

            # append any tracks not in the ATProto list (fallback)
            for track in sorted(all_tracks, key=lambda t: t.created_at):
                if track.id not in seen_ids:
                    ordered_tracks.append(track)

        except Exception as e:
            logger.warning(f"failed to fetch ATProto list for album ordering: {e}")
            # fallback to created_at order
            ordered_tracks = sorted(all_tracks, key=lambda t: t.created_at)
    else:
        # no ATProto record - order by created_at
        ordered_tracks = sorted(all_tracks, key=lambda t: t.created_at)

    tracks = ordered_tracks
    track_ids = [track.id for track in tracks]

    # batch fetch aggregations
    if track_ids:
        like_counts, comment_counts, track_tags = await asyncio.gather(
            get_like_counts(db, track_ids),
            get_comment_counts(db, track_ids),
            get_track_tags(db, track_ids),
        )
    else:
        like_counts, comment_counts, track_tags = {}, {}, {}

    # get authenticated user's likes for this album's tracks only
    liked_track_ids: set[int] | None = None
    if session:
        if track_ids:
            liked_result = await db.execute(
                select(TrackLike.track_id).where(
                    TrackLike.user_did == session.did,
                    TrackLike.track_id.in_(track_ids),
                )
            )
            liked_track_ids = set(liked_result.scalars().all())

    # build track responses (maintaining order)
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track,
                pds_cache.get(track.artist_did),
                liked_track_ids,
                like_counts,
                comment_counts,
                track_tags=track_tags,
            )
            for track in tracks
        ]
    )

    total_plays = sum(t.play_count for t in tracks)
    metadata = await _album_metadata(album, artist, len(tracks), total_plays)

    response = AlbumResponse(
        metadata=metadata,
        tracks=[t.model_dump(mode="json") for t in track_responses],
    )

    # cache a depersonalized copy (is_liked zeroed out)
    try:
        redis = get_async_redis_client()
        cache_tracks = [{**t, "is_liked": False} for t in response.tracks]
        cacheable = AlbumResponse(metadata=response.metadata, tracks=cache_tracks)
        await redis.set(
            cache_key, cacheable.model_dump_json(), ex=ALBUM_CACHE_TTL_SECONDS
        )
    except Exception:
        logger.debug("album cache write failed for %s/%s", handle, slug)

    return response


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

    try:
        uploaded = await process_image_upload(
            image, "album", allowed_extensions=COVER_EXTENSIONS
        )

        # delete old image if exists (prevent R2 object leaks)
        if album.image_id and album.image_id != uploaded.image_id:
            with contextlib.suppress(Exception):
                await storage.delete(album.image_id)

        # update album with new image
        album.image_id = uploaded.image_id
        album.image_url = uploaded.image_url
        album.thumbnail_url = uploaded.thumbnail_url
        await db.commit()

        await invalidate_album_cache(auth_session.handle, album.slug)

        return {
            "image_url": uploaded.image_url,
            "image_id": uploaded.image_id,
            "thumbnail_url": uploaded.thumbnail_url,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to upload image: {e!s}"
        ) from e


@router.patch("/{album_id}")
async def update_album(
    album_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
    title: Annotated[str | None, Query(description="new album title")] = None,
    description: Annotated[
        str | None, Query(description="new album description")
    ] = None,
) -> AlbumMetadata:
    """update album metadata (title, description). syncs ATProto records on title change."""
    from backend._internal.atproto.records.fm_plyr.list import update_list_record
    from backend._internal.atproto.records.fm_plyr.track import (
        build_track_record,
        update_record,
    )

    result = await db.execute(
        select(Album)
        .where(Album.id == album_id)
        .options(selectinload(Album.tracks).selectinload(Track.artist))
    )
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only update your own albums"
        )

    old_title = album.title
    old_slug = album.slug
    title_changed = title is not None and title.strip() != old_title

    if title is not None:
        album.title = title.strip()
        # sync slug when title changes so get_or_create_album lookups work
        if title_changed:
            album.slug = slugify(title.strip())
    if description is not None:
        album.description = description.strip() if description.strip() else None

    # if title changed, update all tracks' extra["album"] and ATProto records
    if title_changed and title is not None:
        new_title = title.strip()

        for track in album.tracks:
            # update the track's extra["album"] field
            if track.extra is None:
                track.extra = {}
            track.extra = {**track.extra, "album": new_title}

            # update ATProto record if track has one
            if track.atproto_record_uri and track.r2_url and track.file_type:
                updated_record = build_track_record(
                    title=track.title,
                    artist=track.artist.display_name,
                    audio_url=track.r2_url,
                    file_type=track.file_type,
                    album=new_title,
                    duration=track.duration,
                    features=track.features if track.features else None,
                    image_url=await track.get_image_url(),
                )

                _, new_cid = await update_record(
                    auth_session=auth_session,
                    record_uri=track.atproto_record_uri,
                    record=updated_record,
                )
                track.atproto_record_cid = new_cid

        # update the album's ATProto list record name
        if album.atproto_record_uri:
            track_refs = [
                {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
                for t in album.tracks
                if t.atproto_record_uri and t.atproto_record_cid
            ]
            _, new_list_cid = await update_list_record(
                auth_session=auth_session,
                list_uri=album.atproto_record_uri,
                items=track_refs,
                name=new_title,
                list_type="album",
                created_at=album.created_at,
            )
            album.atproto_record_cid = new_list_cid

    await db.commit()

    # invalidate cache for old slug (new slug will be a cache miss)
    await invalidate_album_cache(auth_session.handle, old_slug)
    if album.slug != old_slug:
        await invalidate_album_cache(auth_session.handle, album.slug)

    # fetch artist for response
    artist_result = await db.execute(
        select(Artist).where(Artist.did == album.artist_did)
    )
    artist = artist_result.scalar_one()
    track_count, total_plays = await _album_stats(db, album_id)

    return await _album_metadata(album, artist, track_count, total_plays)


@router.delete("/{album_id}/tracks/{track_id}")
async def remove_track_from_album(
    album_id: str,
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
) -> RemoveTrackFromAlbumResponse:
    """remove a track from an album (orphan it, don't delete).

    the track remains available as a standalone track.
    """
    # verify album exists and belongs to the authenticated artist
    album_result = await db.execute(select(Album).where(Album.id == album_id))
    album = album_result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only modify your own albums"
        )

    # verify track exists and is in this album
    track_result = await db.execute(select(Track).where(Track.id == track_id))
    track = track_result.scalar_one_or_none()
    if not track:
        raise HTTPException(status_code=404, detail="track not found")
    if track.album_id != album_id:
        raise HTTPException(status_code=400, detail="track is not in this album")

    # orphan the track
    track.album_id = None
    await db.commit()

    await invalidate_album_cache(auth_session.handle, album.slug)

    return RemoveTrackFromAlbumResponse(track_id=track_id)


@router.delete("/{album_id}")
async def delete_album(
    album_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
    cascade: Annotated[
        bool,
        Query(description="if true, also delete all tracks in the album"),
    ] = False,
) -> DeleteAlbumResponse:
    """delete album. tracks are orphaned unless cascade=true. removes ATProto list record."""
    from backend._internal.atproto.records import delete_record_by_uri

    # verify album exists and belongs to the authenticated artist
    result = await db.execute(select(Album).where(Album.id == album_id))
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only delete your own albums"
        )

    # handle tracks
    if cascade:
        # delete all tracks in album
        from backend.api.tracks.mutations import delete_track

        tracks_result = await db.execute(
            select(Track).where(Track.album_id == album_id)
        )
        tracks = tracks_result.scalars().all()
        for track in tracks:
            try:
                await delete_track(track.id, db, auth_session)
            except Exception as e:
                logger.warning(f"failed to delete track {track.id}: {e}")
    else:
        # orphan tracks - set album_id to null
        from sqlalchemy import update

        await db.execute(
            update(Track).where(Track.album_id == album_id).values(album_id=None)
        )

    # delete ATProto record if exists
    if album.atproto_record_uri:
        try:
            await delete_record_by_uri(auth_session, album.atproto_record_uri)
        except Exception as e:
            logger.warning(f"failed to delete ATProto record: {e}")
            # continue with database cleanup even if ATProto delete fails

    # delete cover image from storage if exists
    if album.image_id:
        with contextlib.suppress(Exception):
            await storage.delete(album.image_id)

    # capture slug before deletion
    album_slug = album.slug

    # delete album from database
    await db.delete(album)
    await db.commit()

    # invalidate cache after commit so concurrent reads can't re-populate from pre-delete state
    await invalidate_album_cache(auth_session.handle, album_slug)

    return DeleteAlbumResponse(cascade=cascade)

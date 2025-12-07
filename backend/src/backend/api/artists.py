"""artist profile API endpoints."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto import (
    fetch_user_avatar,
    normalize_avatar_url,
    upsert_album_list_record,
    upsert_liked_list_record,
    upsert_profile_record,
)
from backend.models import Album, Artist, Track, TrackLike, UserPreferences, get_db
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artists", tags=["artists"])

# hold references to background tasks to prevent GC before completion
_background_tasks: set[asyncio.Task[None]] = set()


def _create_background_task(coro) -> asyncio.Task:
    """Create a background task with proper lifecycle management."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


# request/response models
class CreateArtistRequest(BaseModel):
    """request to create artist profile."""

    display_name: str
    bio: str | None = None
    avatar_url: str | None = None


class UpdateArtistRequest(BaseModel):
    """request to update artist profile."""

    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


class ArtistResponse(BaseModel):
    """artist profile response."""

    model_config = ConfigDict(from_attributes=True)

    did: str
    handle: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    created_at: datetime
    updated_at: datetime
    show_liked_on_profile: bool = False

    @field_validator("avatar_url", mode="before")
    @classmethod
    def normalize_avatar(cls, v: str | None) -> str | None:
        """normalize avatar URL to use Bluesky CDN."""
        return normalize_avatar_url(v)


class TopItemResponse(BaseModel):
    """top item in analytics."""

    id: int
    title: str
    play_count: int


class AnalyticsResponse(BaseModel):
    """analytics data for artist."""

    total_plays: int
    total_items: int
    top_item: TopItemResponse | None
    top_liked: TopItemResponse | None


# endpoints
@router.post("/")
async def create_artist(
    request: CreateArtistRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Session = Depends(require_auth),
) -> ArtistResponse:
    """create artist profile for authenticated user.

    this should be called on first login if artist profile doesn't exist.
    """
    # check if artist already exists
    result = await db.execute(select(Artist).where(Artist.did == auth_session.did))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="artist profile already exists")

    # fetch avatar from Bluesky if not provided
    avatar_url = request.avatar_url
    if not avatar_url:
        avatar_url = await fetch_user_avatar(auth_session.did)
    else:
        avatar_url = normalize_avatar_url(avatar_url)

    # resolve and cache PDS URL for performance
    from atproto_identity.did.resolver import AsyncDidResolver

    resolver = AsyncDidResolver()
    pds_url = None
    try:
        atproto_data = await resolver.resolve_atproto_data(auth_session.did)
        pds_url = atproto_data.pds
    except Exception as e:
        logger.warning(f"failed to resolve PDS for {auth_session.did}: {e}")

    # create artist
    artist = Artist(
        did=auth_session.did,
        handle=auth_session.handle,
        display_name=request.display_name or auth_session.handle,
        bio=request.bio,
        avatar_url=avatar_url,
        pds_url=pds_url,
    )
    db.add(artist)
    await db.commit()
    await db.refresh(artist)

    logger.info(
        f"created artist profile for {auth_session.did} (@{auth_session.handle})"
    )

    # create ATProto profile record if bio was provided
    if request.bio:
        try:
            await upsert_profile_record(auth_session, bio=request.bio)
            logger.info(f"created ATProto profile record for {auth_session.did}")
        except Exception as e:
            # don't fail the request if ATProto record creation fails
            logger.warning(
                f"failed to create ATProto profile record for {auth_session.did}: {e}"
            )

    return ArtistResponse.model_validate(artist)


@router.get("/me")
async def get_my_artist_profile(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Session = Depends(require_auth),
) -> ArtistResponse:
    """get authenticated user's artist profile."""
    result = await db.execute(select(Artist).where(Artist.did == auth_session.did))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(
            status_code=404,
            detail="artist profile not found - please create one first",
        )

    # fire-and-forget sync of ATProto profile record
    # creates record if doesn't exist, skips if unchanged
    async def _sync_profile():
        try:
            result = await upsert_profile_record(auth_session, bio=artist.bio)
            if result:
                logger.info(f"synced ATProto profile record for {auth_session.did}")
        except Exception as e:
            logger.warning(
                f"failed to sync ATProto profile record for {auth_session.did}: {e}"
            )

    _create_background_task(_sync_profile())

    # fire-and-forget sync of album list records
    # query albums and their tracks, then sync each album as a list record
    albums_result = await db.execute(
        select(Album).where(Album.artist_did == auth_session.did)
    )
    albums = albums_result.scalars().all()

    for album in albums:
        # get tracks for this album that have ATProto records
        tracks_result = await db.execute(
            select(Track)
            .where(
                Track.album_id == album.id,
                Track.atproto_record_uri.isnot(None),
                Track.atproto_record_cid.isnot(None),
            )
            .order_by(Track.created_at.asc())
        )
        tracks = tracks_result.scalars().all()

        if tracks:
            track_refs = [
                {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
                for t in tracks
            ]
            # capture values for closure
            album_id = album.id
            album_title = album.title
            existing_uri = album.atproto_record_uri

            async def _sync_album(
                aid=album_id, title=album_title, refs=track_refs, uri=existing_uri
            ):
                try:
                    result = await upsert_album_list_record(
                        auth_session,
                        album_id=aid,
                        album_title=title,
                        track_refs=refs,
                        existing_uri=uri,
                    )
                    if result:
                        # persist the new URI/CID to the database
                        async with db_session() as session:
                            album_to_update = await session.get(Album, aid)
                            if album_to_update:
                                album_to_update.atproto_record_uri = result[0]
                                album_to_update.atproto_record_cid = result[1]
                                await session.commit()
                        logger.info(f"synced album list record for {aid}: {result[0]}")
                except Exception as e:
                    logger.warning(f"failed to sync album list record for {aid}: {e}")

            _create_background_task(_sync_album())

    # fire-and-forget sync of liked tracks list record
    # query user's likes and sync as a single list record
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == auth_session.did)
    )
    prefs = prefs_result.scalar_one_or_none()

    likes_result = await db.execute(
        select(Track)
        .join(TrackLike, TrackLike.track_id == Track.id)
        .where(
            TrackLike.user_did == auth_session.did,
            Track.atproto_record_uri.isnot(None),
            Track.atproto_record_cid.isnot(None),
        )
        .order_by(TrackLike.created_at.desc())
    )
    liked_tracks = likes_result.scalars().all()

    if liked_tracks:
        liked_refs = [
            {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
            for t in liked_tracks
        ]
        existing_liked_uri = prefs.liked_list_uri if prefs else None
        user_did = auth_session.did

        async def _sync_liked():
            try:
                result = await upsert_liked_list_record(
                    auth_session,
                    track_refs=liked_refs,
                    existing_uri=existing_liked_uri,
                )
                if result:
                    # persist the new URI/CID to user preferences
                    async with db_session() as session:
                        user_prefs = await session.get(UserPreferences, user_did)
                        if user_prefs:
                            user_prefs.liked_list_uri = result[0]
                            user_prefs.liked_list_cid = result[1]
                            await session.commit()
                        else:
                            # create preferences if they don't exist
                            new_prefs = UserPreferences(
                                did=user_did,
                                liked_list_uri=result[0],
                                liked_list_cid=result[1],
                            )
                            session.add(new_prefs)
                            await session.commit()
                    logger.info(f"synced liked list record for {user_did}: {result[0]}")
            except Exception as e:
                logger.warning(f"failed to sync liked list record for {user_did}: {e}")

        _create_background_task(_sync_liked())

    return ArtistResponse.model_validate(artist)


@router.put("/me")
async def update_my_artist_profile(
    request: UpdateArtistRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Session = Depends(require_auth),
) -> ArtistResponse:
    """update authenticated user's artist profile."""
    result = await db.execute(select(Artist).where(Artist.did == auth_session.did))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(
            status_code=404,
            detail="artist profile not found - please create one first",
        )

    # update fields if provided
    if request.display_name is not None:
        artist.display_name = request.display_name
    if request.bio is not None:
        artist.bio = request.bio
    if request.avatar_url is not None:
        artist.avatar_url = normalize_avatar_url(request.avatar_url)

    artist.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(artist)

    logger.info(f"updated artist profile for {auth_session.did}")

    # update ATProto profile record if bio was changed
    if request.bio is not None:
        try:
            await upsert_profile_record(auth_session, bio=request.bio)
            logger.info(f"updated ATProto profile record for {auth_session.did}")
        except Exception as e:
            # don't fail the request if ATProto record update fails
            logger.warning(
                f"failed to update ATProto profile record for {auth_session.did}: {e}"
            )

    return ArtistResponse.model_validate(artist)


@router.get("/by-handle/{handle}")
async def get_artist_profile_by_handle(
    handle: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> ArtistResponse:
    """get artist profile by handle (public endpoint)."""
    result = await db.execute(select(Artist).where(Artist.handle == handle))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=404, detail="artist not found")

    # fetch user preference for showing liked tracks
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == artist.did)
    )
    prefs = prefs_result.scalar_one_or_none()
    show_liked = prefs.show_liked_on_profile if prefs else False

    response = ArtistResponse.model_validate(artist)
    response.show_liked_on_profile = show_liked
    return response


@router.get("/{did}")
async def get_artist_profile_by_did(
    did: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> ArtistResponse:
    """get artist profile by DID (public endpoint)."""
    result = await db.execute(select(Artist).where(Artist.did == did))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=404, detail="artist not found")

    # fetch user preference for showing liked tracks
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == artist.did)
    )
    prefs = prefs_result.scalar_one_or_none()
    show_liked = prefs.show_liked_on_profile if prefs else False

    response = ArtistResponse.model_validate(artist)
    response.show_liked_on_profile = show_liked
    return response


@router.get("/{artist_did}/analytics")
async def get_artist_analytics(
    artist_did: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AnalyticsResponse:
    """get public analytics for any artist by DID.

    returns zeros if artist has no tracks.
    """
    # get total plays and item count in one query
    result = await db.execute(
        select(func.sum(Track.play_count), func.count(Track.id)).where(
            Track.artist_did == artist_did
        )
    )
    total_plays, total_items = result.one()
    total_plays = total_plays or 0  # handle None when no tracks
    total_items = total_items or 0

    # get top item by plays (only if artist has tracks)
    top_item = None
    if total_items > 0:
        result = await db.execute(
            select(Track.id, Track.title, Track.play_count)
            .where(Track.artist_did == artist_did)
            .order_by(Track.play_count.desc())
            .limit(1)
        )
        top_track_row = result.first()
        if top_track_row:
            top_item = TopItemResponse(
                id=top_track_row[0],
                title=top_track_row[1],
                play_count=top_track_row[2],
            )

    # get top liked track (only if artist has tracks)
    top_liked = None
    if total_items > 0:
        result = await db.execute(
            select(Track.id, Track.title, func.count(TrackLike.id).label("like_count"))
            .join(TrackLike, TrackLike.track_id == Track.id)
            .where(Track.artist_did == artist_did)
            .group_by(Track.id, Track.title)
            .order_by(func.count(TrackLike.id).desc())
            .limit(1)
        )
        top_liked_row = result.first()
        if top_liked_row:
            top_liked = TopItemResponse(
                id=top_liked_row[0],
                title=top_liked_row[1],
                play_count=top_liked_row[2],  # reuse play_count field for like count
            )

    return AnalyticsResponse(
        total_plays=total_plays,
        total_items=total_items,
        top_item=top_item,
        top_liked=top_liked,
    )


@router.get("/me/analytics")
async def get_my_analytics(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Session = Depends(require_auth),
) -> AnalyticsResponse:
    """get analytics for authenticated artist.

    returns zeros if artist has no tracks - no need to verify artist exists.
    """
    return await get_artist_analytics(auth_session.did, db)

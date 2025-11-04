"""artist profile API endpoints."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from relay._internal import Session, require_auth
from relay.atproto import fetch_user_avatar
from relay.models import Artist, get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artists", tags=["artists"])


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

    # create artist
    artist = Artist(
        did=auth_session.did,
        handle=auth_session.handle,
        display_name=request.display_name or auth_session.handle,
        bio=request.bio,
        avatar_url=avatar_url,
    )
    db.add(artist)
    await db.commit()
    await db.refresh(artist)

    logger.info(
        f"created artist profile for {auth_session.did} (@{auth_session.handle})"
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
        artist.avatar_url = request.avatar_url

    artist.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(artist)

    logger.info(f"updated artist profile for {auth_session.did}")
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
    return ArtistResponse.model_validate(artist)


@router.get("/{did}")
async def get_artist_profile_by_did(
    did: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> ArtistResponse:
    """get artist profile by DID (public endpoint)."""
    result = await db.execute(select(Artist).where(Artist.did == did))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=404, detail="artist not found")
    return ArtistResponse.model_validate(artist)

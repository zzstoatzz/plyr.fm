"""artist profile API endpoints."""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from relay.atproto import fetch_user_avatar
from relay.auth import Session, require_auth
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

    did: str
    handle: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# endpoints
@router.post("/")
async def create_artist(
    request: CreateArtistRequest,
    auth_session: Session = Depends(require_auth),
) -> ArtistResponse:
    """create artist profile for authenticated user.

    this should be called on first login if artist profile doesn't exist.
    """
    db = next(get_db())
    try:
        # check if artist already exists
        existing = db.query(Artist).filter(Artist.did == auth_session.did).first()
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
        db.commit()
        db.refresh(artist)

        logger.info(
            f"created artist profile for {auth_session.did} (@{auth_session.handle})"
        )
        return artist

    finally:
        db.close()


@router.get("/me")
async def get_my_artist_profile(auth_session: Session = Depends(require_auth)) -> ArtistResponse:
    """get authenticated user's artist profile."""
    db = next(get_db())
    try:
        artist = db.query(Artist).filter(Artist.did == auth_session.did).first()
        if not artist:
            raise HTTPException(
                status_code=404,
                detail="artist profile not found - please create one first",
            )
        return artist
    finally:
        db.close()


@router.put("/me")
async def update_my_artist_profile(
    request: UpdateArtistRequest,
    auth_session: Session = Depends(require_auth),
) -> ArtistResponse:
    """update authenticated user's artist profile."""
    db = next(get_db())
    try:
        artist = db.query(Artist).filter(Artist.did == auth_session.did).first()
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

        artist.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(artist)

        logger.info(f"updated artist profile for {auth_session.did}")
        return artist

    finally:
        db.close()


@router.get("/by-handle/{handle}")
async def get_artist_profile_by_handle(handle: str) -> ArtistResponse:
    """get artist profile by handle (public endpoint)."""
    db = next(get_db())
    try:
        artist = db.query(Artist).filter(Artist.handle == handle).first()
        if not artist:
            raise HTTPException(status_code=404, detail="artist not found")
        return artist
    finally:
        db.close()


@router.get("/{did}")
async def get_artist_profile_by_did(did: str) -> ArtistResponse:
    """get artist profile by DID (public endpoint)."""
    db = next(get_db())
    try:
        artist = db.query(Artist).filter(Artist.did == did).first()
        if not artist:
            raise HTTPException(status_code=404, detail="artist not found")
        return artist
    finally:
        db.close()

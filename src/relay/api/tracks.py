"""tracks api endpoints."""

import json
import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from relay._internal import Session as AuthSession
from relay._internal import require_artist_profile, require_auth
from relay.atproto import create_track_record
from relay.atproto.handles import resolve_handle
from relay.config import settings
from relay.models import Artist, AudioFormat, Track, get_db
from relay.storage import storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tracks", tags=["tracks"])

# max featured artists per track
MAX_FEATURES = 5


@router.post("/")
async def upload_track(
    title: Annotated[str, Form()],
    album: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,  # JSON array of handles
    file: UploadFile = File(...),
    auth_session: AuthSession = Depends(require_artist_profile),
    db: Session = Depends(get_db),
) -> dict:
    """upload a new track (requires authentication and artist profile).

    features: optional JSON array of ATProto handles, e.g., ["user1.bsky.social", "user2.bsky.social"]
    """
    # validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    ext = Path(file.filename).suffix.lower()
    audio_format = AudioFormat.from_extension(ext)
    if not audio_format:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported file type: {ext}. "
            f"supported: {AudioFormat.supported_extensions_str()}",
        )

    # save audio file
    try:
        file_id = storage.save(file.file, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # get R2 URL
    r2_url = None
    if settings.storage_backend == "r2":
        from relay.storage.r2 import R2Storage

        if isinstance(storage, R2Storage):
            r2_url = storage.get_url(file_id)

    # get artist profile
    artist = db.query(Artist).filter(Artist.did == auth_session.did).first()
    if not artist:
        raise HTTPException(
            status_code=500,
            detail="artist profile not found - this should not happen after require_artist_profile",
        )

    # resolve featured artist handles
    featured_artists = []
    if features:
        try:
            handles_list = json.loads(features)
            if not isinstance(handles_list, list):
                raise HTTPException(
                    status_code=400, detail="features must be a JSON array of handles"
                )

            if len(handles_list) > MAX_FEATURES:
                raise HTTPException(
                    status_code=400,
                    detail=f"maximum {MAX_FEATURES} featured artists allowed",
                )

            # resolve each handle
            for handle in handles_list:
                if not isinstance(handle, str):
                    raise HTTPException(
                        status_code=400, detail="each feature must be a string handle"
                    )

                # prevent self-featuring
                if handle.lstrip("@") == artist.handle:
                    continue  # skip self-feature silently

                resolved = await resolve_handle(handle)
                if not resolved:
                    raise HTTPException(
                        status_code=400, detail=f"failed to resolve handle: {handle}"
                    )

                featured_artists.append(resolved)

        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400, detail=f"invalid JSON in features: {e}"
            ) from e

    # create ATProto record (if R2 URL available)
    atproto_uri = None
    atproto_cid = None
    if r2_url:
        try:
            result = await create_track_record(
                auth_session=auth_session,
                title=title,
                artist=artist.display_name,
                audio_url=r2_url,
                file_type=ext[1:],  # remove dot
                album=album,
                duration=None,  # TODO: extract from audio file
                features=featured_artists if featured_artists else None,
            )
            if result:
                atproto_uri, atproto_cid = result
        except Exception as e:
            # log but don't fail upload if record creation fails
            logger.warning(f"failed to create ATProto record: {e}", exc_info=True)

    # create track record with artist identity
    extra = {}
    if album:
        extra["album"] = album

    track = Track(
        title=title,
        file_id=file_id,
        file_type=ext[1:],  # remove the dot
        artist_did=auth_session.did,
        extra=extra,
        features=featured_artists,  # list of {did, handle, display_name, avatar_url}
        r2_url=r2_url,
        atproto_record_uri=atproto_uri,
        atproto_record_cid=atproto_cid,
    )

    db.add(track)
    db.commit()
    db.refresh(track)

    return {
        "id": track.id,
        "title": track.title,
        "artist": artist.display_name,
        "artist_handle": artist.handle,
        "album": track.album,
        "file_id": track.file_id,
        "file_type": track.file_type,
        "artist_did": track.artist_did,
        "features": track.features,
        "r2_url": track.r2_url,
        "atproto_record_uri": track.atproto_record_uri,
        "created_at": track.created_at.isoformat(),
    }


@router.get("/")
async def list_tracks(
    artist_did: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """list all tracks, optionally filtered by artist DID."""
    from atproto_identity.did.resolver import AsyncDidResolver

    query = db.query(Track).join(Artist)

    # filter by artist if provided
    if artist_did:
        query = query.filter(Track.artist_did == artist_did)

    tracks = query.order_by(Track.created_at.desc()).all()

    # resolve PDS URLs for each unique artist DID
    resolver = AsyncDidResolver()
    pds_cache = {}

    for track in tracks:
        if track.artist_did not in pds_cache:
            try:
                atproto_data = await resolver.resolve_atproto_data(track.artist_did)
                pds_cache[track.artist_did] = atproto_data.pds
            except Exception as e:
                logger.warning(f"failed to resolve PDS for {track.artist_did}: {e}")
                pds_cache[track.artist_did] = None

    return {
        "tracks": [
            {
                "id": track.id,
                "title": track.title,
                "artist": track.artist.display_name,
                "artist_handle": track.artist.handle,
                "artist_avatar_url": track.artist.avatar_url,
                "album": track.album,
                "file_id": track.file_id,
                "file_type": track.file_type,
                "features": track.features,
                "r2_url": track.r2_url,
                "atproto_record_uri": track.atproto_record_uri,
                "atproto_record_url": (
                    f"{pds_cache[track.artist_did]}/xrpc/com.atproto.repo.getRecord"
                    f"?repo={track.artist_did}&collection=app.relay.track"
                    f"&rkey={track.atproto_record_uri.split('/')[-1]}"
                    if track.atproto_record_uri and pds_cache.get(track.artist_did)
                    else None
                ),
                "play_count": track.play_count,
                "created_at": track.created_at.isoformat(),
            }
            for track in tracks
        ]
    }


@router.get("/me")
async def list_my_tracks(
    auth_session: AuthSession = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict:
    """list tracks uploaded by authenticated user."""
    tracks = (
        db.query(Track)
        .join(Artist)
        .filter(Track.artist_did == auth_session.did)
        .order_by(Track.created_at.desc())
        .all()
    )

    return {
        "tracks": [
            {
                "id": track.id,
                "title": track.title,
                "artist": track.artist.display_name,
                "artist_handle": track.artist.handle,
                "album": track.album,
                "file_id": track.file_id,
                "file_type": track.file_type,
                "features": track.features,
                "r2_url": track.r2_url,
                "atproto_record_uri": track.atproto_record_uri,
                "play_count": track.play_count,
                "created_at": track.created_at.isoformat(),
            }
            for track in tracks
        ]
    }


@router.delete("/{track_id}")
async def delete_track(
    track_id: int,
    auth_session: AuthSession = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict:
    """delete a track (only by owner)."""
    track = db.query(Track).filter(Track.id == track_id).first()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # verify ownership
    if track.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only delete your own tracks",
        )

    # delete audio file from storage
    try:
        storage.delete(track.file_id)
    except Exception as e:
        # log but don't fail - maybe file was already deleted
        logger.warning(f"failed to delete file {track.file_id}: {e}", exc_info=True)

    # delete track record
    db.delete(track)
    db.commit()

    return {"message": "track deleted successfully"}


@router.patch("/{track_id}")
async def update_track_metadata(
    track_id: int,
    title: Annotated[str | None, Form()] = None,
    album: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,  # JSON array of handles
    auth_session: AuthSession = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict:
    """update track metadata (only by owner).

    features: optional JSON array of ATProto handles, e.g., ["user1.bsky.social", "user2.bsky.social"]
    """
    track = db.query(Track).join(Artist).filter(Track.id == track_id).first()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # verify ownership
    if track.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only edit your own tracks",
        )

    # update fields if provided
    if title is not None:
        track.title = title

    if album is not None:
        if album:
            # set or update album
            if track.extra is None:
                track.extra = {}
            track.extra["album"] = album
        else:
            # remove album if empty string
            if track.extra and "album" in track.extra:
                del track.extra["album"]

    if features is not None:
        # resolve featured artist handles
        featured_artists = []
        try:
            handles_list = json.loads(features)
            if not isinstance(handles_list, list):
                raise HTTPException(
                    status_code=400, detail="features must be a JSON array of handles"
                )

            if len(handles_list) > MAX_FEATURES:
                raise HTTPException(
                    status_code=400,
                    detail=f"maximum {MAX_FEATURES} featured artists allowed",
                )

            # resolve each handle
            for handle in handles_list:
                if not isinstance(handle, str):
                    raise HTTPException(
                        status_code=400, detail="each feature must be a string handle"
                    )

                # prevent self-featuring
                if handle.lstrip("@") == track.artist.handle:
                    continue  # skip self-feature silently

                resolved = await resolve_handle(handle)
                if not resolved:
                    raise HTTPException(
                        status_code=400, detail=f"failed to resolve handle: {handle}"
                    )

                featured_artists.append(resolved)

            track.features = featured_artists

        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400, detail=f"invalid JSON in features: {e}"
            ) from e

    db.commit()
    db.refresh(track)

    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist.display_name,
        "artist_handle": track.artist.handle,
        "artist_avatar_url": track.artist.avatar_url,
        "album": track.album,
        "file_id": track.file_id,
        "file_type": track.file_type,
        "r2_url": track.r2_url,
        "atproto_record_uri": track.atproto_record_uri,
        "play_count": track.play_count,
        "created_at": track.created_at.isoformat(),
    }


@router.get("/{track_id}")
async def get_track(track_id: int, db: Session = Depends(get_db)) -> dict:
    """get a specific track."""
    track = db.query(Track).join(Artist).filter(Track.id == track_id).first()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist.display_name,
        "artist_handle": track.artist.handle,
        "album": track.album,
        "file_id": track.file_id,
        "file_type": track.file_type,
        "r2_url": track.r2_url,
        "atproto_record_uri": track.atproto_record_uri,
        "play_count": track.play_count,
        "created_at": track.created_at.isoformat(),
    }


@router.post("/{track_id}/play")
async def increment_play_count(track_id: int, db: Session = Depends(get_db)) -> dict:
    """increment play count for a track (called after 30 seconds of playback)."""
    track = db.query(Track).filter(Track.id == track_id).first()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # atomic increment using ORM
    track.play_count += 1
    db.commit()
    db.refresh(track)

    return {"play_count": track.play_count}

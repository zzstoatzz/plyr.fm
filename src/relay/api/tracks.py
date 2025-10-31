"""tracks api endpoints."""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from relay.atproto import create_track_record
from relay.auth import Session as AuthSession
from relay.auth import require_auth
from relay.config import settings
from relay.models import AudioFormat, Track, get_db
from relay.storage import storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tracks", tags=["tracks"])


@router.post("/")
async def upload_track(
    title: Annotated[str, Form()],
    artist: Annotated[str, Form()],
    album: Annotated[str | None, Form()] = None,
    file: UploadFile = File(...),
    auth_session: AuthSession = Depends(require_auth),
    db: Session = Depends(get_db),
) -> dict:
    """upload a new track (requires authentication)."""
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

    # create ATProto record (if R2 URL available)
    atproto_uri = None
    atproto_cid = None
    if r2_url:
        try:
            atproto_uri, atproto_cid = await create_track_record(
                auth_session=auth_session,
                title=title,
                artist=artist,
                audio_url=r2_url,
                file_type=ext[1:],  # remove dot
                album=album,
                duration=None,  # TODO: extract from audio file
            )
        except Exception as e:
            # log but don't fail upload if record creation fails
            logger.warning(f"failed to create ATProto record: {e}", exc_info=True)

    # create track record with artist identity
    extra = {}
    if album:
        extra["album"] = album

    track = Track(
        title=title,
        artist=artist,
        file_id=file_id,
        file_type=ext[1:],  # remove the dot
        artist_did=auth_session.did,
        artist_handle=auth_session.handle,
        extra=extra,
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
        "artist": track.artist,
        "album": track.album,
        "file_id": track.file_id,
        "file_type": track.file_type,
        "artist_did": track.artist_did,
        "artist_handle": track.artist_handle,
        "r2_url": track.r2_url,
        "atproto_record_uri": track.atproto_record_uri,
        "created_at": track.created_at.isoformat(),
    }


@router.get("/")
async def list_tracks(db: Session = Depends(get_db)) -> dict:
    """list all tracks."""
    tracks = db.query(Track).order_by(Track.created_at.desc()).all()

    return {
        "tracks": [
            {
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "album": track.album,
                "file_id": track.file_id,
                "file_type": track.file_type,
                "artist_handle": track.artist_handle,
                "r2_url": track.r2_url,
                "atproto_record_uri": track.atproto_record_uri,
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
        .filter(Track.artist_did == auth_session.did)
        .order_by(Track.created_at.desc())
        .all()
    )

    return {
        "tracks": [
            {
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "album": track.album,
                "file_id": track.file_id,
                "file_type": track.file_type,
                "artist_handle": track.artist_handle,
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


@router.get("/{track_id}")
async def get_track(track_id: int, db: Session = Depends(get_db)) -> dict:
    """get a specific track."""
    track = db.query(Track).filter(Track.id == track_id).first()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist,
        "album": track.album,
        "file_id": track.file_id,
        "file_type": track.file_type,
        "artist_handle": track.artist_handle,
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

"""tracks api endpoints."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from relay.auth import Session as AuthSession
from relay.auth import require_auth
from relay.models import AudioFormat, Track, get_db
from relay.storage import storage

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

    # create track record with artist identity
    track = Track(
        title=title,
        artist=artist,
        album=album,
        file_id=file_id,
        file_type=ext[1:],  # remove the dot
        artist_did=auth_session.did,
        artist_handle=auth_session.handle,
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
                "created_at": track.created_at.isoformat(),
            }
            for track in tracks
        ]
    }


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
        "created_at": track.created_at.isoformat(),
    }

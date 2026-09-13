"""Restore public audio after an artist removes access restrictions."""

import logfire
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.pds_audio import upload_stored_audio
from backend.models import Track
from backend.storage import storage
from backend.storage.keys import AudioKey

from .uploads import _should_upload_pds_blob


async def prepare_public(db: AsyncSession, track: Track, session: Session) -> None:
    key = AudioKey.for_track(
        file_id=track.file_id, file_type=track.file_type, r2_url=track.r2_url
    )
    blob = None
    if await _should_upload_pds_blob(db, session.did):
        size = await storage.head_file(key.file_id, key.extension, private=True)
        if size is None:
            raise ValueError("protected audio is unavailable")

        blob = await upload_stored_audio(
            session,
            key,
            size,
            private=True,
        )
        if not blob.get("ref", {}).get("$link") or blob.get("size") != size:
            raise ValueError("PDS did not confirm the audio blob")
    audio_url = await storage.copy_audio_to_public(key.file_id, key.extension)
    if track.original_file_id and track.original_file_id != track.file_id:
        await storage.copy_audio_to_public(
            track.original_file_id, track.original_file_type or track.file_type
        )
    track.audio_storage = "both" if blob else "r2"
    track.r2_url = audio_url
    track.pds_blob_cid = blob["ref"]["$link"] if blob else None
    track.pds_blob_size = blob["size"] if blob else None
    logfire.info(
        "public audio prepared", track_id=track.id, pds_blob_cid=track.pds_blob_cid
    )

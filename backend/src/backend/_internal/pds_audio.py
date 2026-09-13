"""Streaming stored audio to a PDS for saves, restores and policy changes."""

from collections.abc import AsyncIterable

from backend._internal.atproto import upload_blob
from backend._internal.atproto.client import BlobRef
from backend._internal.auth import Session
from backend.storage import storage
from backend.storage.keys import AudioKey


async def upload_stored_audio(
    session: Session, key: AudioKey, content_length: int, *, private: bool = False
) -> BlobRef:
    def body_factory() -> AsyncIterable[bytes]:
        return storage.stream_file_data(key.file_id, key.extension, private=private)

    return await upload_blob(
        session,
        body_factory=body_factory,
        content_length=content_length,
        content_type=key.format.media_type,
    )

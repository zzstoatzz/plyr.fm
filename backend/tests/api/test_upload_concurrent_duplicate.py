"""regression: a double-submitted upload must produce exactly one track.

2026-09-18: two clicks on the upload form opened two sessions for the same
file. both workers passed `_check_duplicate` before either reserved its row,
so the artist got two tracks (and two PDS records) for one file.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend.api.tracks.uploads import (
    AudioInfo,
    StorageResult,
    UploadContext,
    _process_upload_background,
)
from backend.models import Artist, Track
from backend.utilities.audio_formats import AudioFormat

ARTIST_DID = "did:plc:doublesubmit"
FILE_ID = "samebytes0000001"


class _MockSession(Session):
    def __init__(self) -> None:
        self.did = ARTIST_DID
        self.handle = "double.test"
        self.session_id = "session-id"
        self.oauth_session = {"did": ARTIST_DID, "access_token": "tok"}


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    row = Artist(did=ARTIST_DID, handle="double.test", display_name="Double")
    db_session.add(row)
    await db_session.commit()
    return row


def _ctx(upload_id: str) -> UploadContext:
    return UploadContext(
        upload_id=upload_id,
        auth_session=_MockSession(),
        audio_file_id=FILE_ID,
        filename="psalms.mp3",
        duration=600,
        title="psalms",
        artist_did=ARTIST_DID,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
    )


async def test_concurrent_uploads_of_same_file_create_one_track(
    db_session: AsyncSession, artist: Artist
) -> None:
    sr = StorageResult(
        file_id=FILE_ID,
        original_file_id=None,
        original_file_type=None,
        playable_format=AudioFormat.MP3,
        r2_url=f"https://audio.example/{FILE_ID}.mp3",
        transcode_info=None,
    )

    # hold both workers between the early duplicate check and the reservation
    arrived = 0
    both_arrived = asyncio.Event()

    async def pds_barrier(*_: object, **__: object) -> None:
        nonlocal arrived
        arrived += 1
        if arrived == 2:
            both_arrived.set()
        await asyncio.wait_for(both_arrived.wait(), timeout=10)

    job_service = AsyncMock()
    with (
        patch("backend.api.tracks.uploads.job_service", job_service),
        patch(
            "backend.api.tracks.uploads._validate_audio",
            AsyncMock(
                return_value=AudioInfo(
                    format=AudioFormat.MP3, duration=600, is_gated=False
                )
            ),
        ),
        patch("backend.api.tracks.uploads._store_audio", AsyncMock(return_value=sr)),
        patch("backend.api.tracks.uploads._upload_to_pds", pds_barrier),
        patch(
            "backend.api.tracks.uploads._store_image",
            AsyncMock(return_value=(None, None, None)),
        ),
        patch(
            "backend.api.tracks.uploads.create_track_record",
            AsyncMock(return_value=("at://ignored", "bafycid")),
        ) as mock_create_record,
        patch("backend.api.tracks.uploads._schedule_post_upload", AsyncMock()),
        patch(
            "backend.api.tracks.uploads.storage.discard_staged",
            AsyncMock(return_value=False),
        ),
        patch("backend.api.tracks.uploads.storage.delete", AsyncMock()) as mock_delete,
    ):
        await asyncio.gather(
            _process_upload_background(_ctx("upload-a")),
            _process_upload_background(_ctx("upload-b")),
        )

    rows = (
        (await db_session.execute(select(Track).where(Track.artist_did == ARTIST_DID)))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert mock_create_record.await_count == 1
    mock_delete.assert_not_called()

    failures = [
        c
        for c in job_service.update_progress.call_args_list
        if "duplicate upload" in str(c)
    ]
    assert len(failures) == 1

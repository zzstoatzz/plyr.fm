"""Exports preserve source authority and never publish protected archives."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.spaces.client import SpaceAccessError
from backend._internal.export_tasks import process_album_download, process_export
from backend.models import Artist, Track
from tests.api.track_audio_replace._helpers import MockSession


class Body:
    async def iter_chunks(self) -> AsyncIterator[bytes]:
        yield b"audio bytes"


@pytest.mark.parametrize("source", ["r2", "r2_private", "space", "space_refused"])
async def test_artist_export_preserves_source_and_archive_privacy(
    db_session: AsyncSession, source: str
) -> None:
    artist = Artist(
        did="did:plc:exporter", handle="exporter.test", display_name="Exporter"
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="Song",
        artist_did=artist.did,
        file_id="aabbccddeeff0011",
        file_type="mp3",
        audio_storage="pds" if source.startswith("space") else source,
        visibility="private" if source.startswith("space") else "public",
        space_uri="at://did:plc:authority/space/example"
        if source.startswith("space")
        else None,
        pds_blob_cid="bafkblob" if source.startswith("space") else None,
        extra={"download_policy": "off"},
    )
    db_session.add(track)
    await db_session.commit()
    client = MagicMock()
    client.get_object = AsyncMock(return_value={"Body": Body()})
    client.upload_fileobj = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    session_factory = MagicMock()
    session_factory.client.return_value = client
    jobs = MagicMock(update_progress=AsyncMock())
    owner_session = MockSession(artist.did)
    space_read = MagicMock()

    @asynccontextmanager
    async def blob(*args, **kwargs) -> AsyncIterator[httpx.Response]:
        space_read(*args, **kwargs)
        if source == "space_refused":
            raise SpaceAccessError("authority refused")
        yield httpx.Response(200, content=b"space bytes")

    with (
        patch(
            "backend._internal.export_tasks.aioboto3.Session",
            return_value=session_factory,
        ),
        patch("backend._internal.export_tasks.job_service", jobs),
        patch("backend._internal.export_tasks.R2ProgressTracker") as tracker,
        patch(
            "backend._internal.export_tasks.get_session",
            AsyncMock(return_value=owner_session),
        ),
        patch("backend._internal.export_tasks.open_space_blob", blob),
        patch("backend._internal.export_tasks.storage") as storage,
    ):
        storage.audio_bucket_name = "public"
        storage.private_audio_bucket_name = "private"
        tracker.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        tracker.return_value.__aexit__ = AsyncMock(return_value=None)
        await process_export("export-test", artist.did, session_id="session-id")

    if source == "space_refused":
        client.upload_fileobj.assert_not_awaited()
        assert jobs.update_progress.call_args.args[1] == "failed"
        return
    client.upload_fileobj.assert_awaited_once()
    assert client.upload_fileobj.call_args.args[1] == "private"
    result = jobs.update_progress.call_args.kwargs["result"]
    assert result["r2_key"] == "exports/export-test.zip"
    assert result["download_url"].endswith("/exports/export-test/download")
    if source.startswith("space"):
        client.get_object.assert_not_awaited()
        assert space_read.call_args.args[0] is owner_session
        assert space_read.call_args.kwargs["space"] == track.space_uri
    else:
        assert client.get_object.call_args.kwargs["Bucket"] == (
            "private" if source == "r2_private" else "public"
        )


async def test_album_job_keeps_zip_private_and_returns_permission_check(
    db_session: AsyncSession,
) -> None:
    artist = Artist(
        did="did:plc:album-export", handle="album-export.test", display_name="Artist"
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="Song",
        artist_did=artist.did,
        file_id="aabbccddeeff0011",
        file_type="mp3",
        audio_storage="r2_private",
    )
    db_session.add(track)
    await db_session.commit()
    client = MagicMock()
    client.get_object = AsyncMock(return_value={"Body": Body()})
    client.upload_fileobj = AsyncMock()
    client.list_objects_v2 = AsyncMock(return_value={})
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    session_factory = MagicMock()
    session_factory.client.return_value = client
    jobs = MagicMock(update_progress=AsyncMock())
    with (
        patch(
            "backend._internal.export_tasks.aioboto3.Session",
            return_value=session_factory,
        ),
        patch("backend._internal.export_tasks.job_service", jobs),
        patch("backend._internal.export_tasks.storage") as storage,
    ):
        storage.private_audio_bucket_name = "private"
        storage.audio_bucket_name = "public"
        await process_album_download(
            "job",
            [track.id],
            "exports/albums/album-digest.zip",
            "album.zip",
            download_path="https://api.test/albums/artist/album/download",
        )
    assert client.get_object.call_args.kwargs["Bucket"] == "private"
    assert client.upload_fileobj.call_args.args[1] == "private"
    assert (
        jobs.update_progress.call_args.kwargs["result"]["download_url"]
        == "https://api.test/albums/artist/album/download"
    )

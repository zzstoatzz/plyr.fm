"""tests for background task scheduling."""

import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import backend._internal.background_tasks as bg_tasks


async def test_schedule_export_uses_docket() -> None:
    """schedule_export should add task to docket."""
    calls: list[tuple[str, str]] = []

    async def mock_schedule(export_id: str, artist_did: str) -> None:
        calls.append((export_id, artist_did))

    mock_docket = MagicMock()
    mock_docket.add = MagicMock(return_value=mock_schedule)

    with (
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "process_export", MagicMock()),
    ):
        await bg_tasks.schedule_export("export-123", "did:plc:testuser")

        mock_docket.add.assert_called_once()
        assert calls == [("export-123", "did:plc:testuser")]


async def test_schedule_copyright_scan_uses_docket() -> None:
    """schedule_copyright_scan should add task to docket."""
    calls: list[tuple[int, str]] = []

    async def mock_schedule(track_id: int, audio_url: str) -> None:
        calls.append((track_id, audio_url))

    mock_docket = MagicMock()
    mock_docket.add = MagicMock(return_value=mock_schedule)

    with (
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "scan_copyright", MagicMock()),
    ):
        await bg_tasks.schedule_copyright_scan(123, "https://example.com/audio.mp3")

        mock_docket.add.assert_called_once()
        assert calls == [(123, "https://example.com/audio.mp3")]


async def test_schedule_atproto_sync_uses_docket() -> None:
    """schedule_atproto_sync should add task to docket."""
    calls: list[tuple[str, str]] = []

    async def mock_schedule(session_id: str, user_did: str) -> None:
        calls.append((session_id, user_did))

    mock_docket = MagicMock()
    mock_docket.add = MagicMock(return_value=mock_schedule)

    with (
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "sync_atproto", MagicMock()),
    ):
        await bg_tasks.schedule_atproto_sync("session-abc", "did:plc:testuser")

        mock_docket.add.assert_called_once()
        assert calls == [("session-abc", "did:plc:testuser")]


async def test_schedule_teal_scrobble_uses_docket() -> None:
    """schedule_teal_scrobble should add task to docket."""
    calls: list[tuple] = []

    async def mock_schedule(
        session_id: str,
        track_id: int,
        track_title: str,
        artist_name: str,
        duration: int | None,
        album_name: str | None,
    ) -> None:
        calls.append(
            (session_id, track_id, track_title, artist_name, duration, album_name)
        )

    mock_docket = MagicMock()
    mock_docket.add = MagicMock(return_value=mock_schedule)

    with (
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "scrobble_to_teal", MagicMock()),
    ):
        await bg_tasks.schedule_teal_scrobble(
            session_id="session-xyz",
            track_id=42,
            track_title="Test Track",
            artist_name="Test Artist",
            duration=180,
            album_name="Test Album",
        )

        mock_docket.add.assert_called_once()
        assert calls == [
            ("session-xyz", 42, "Test Track", "Test Artist", 180, "Test Album")
        ]


async def test_process_export_downloads_concurrently() -> None:
    """process_export should download tracks concurrently, not sequentially.

    regression test: previously tracks were downloaded one at a time,
    making exports slow for users with many tracks or large files.
    """
    download_times: list[float] = []
    download_start_event = asyncio.Event()

    async def mock_get_object(Bucket: str, Key: str) -> dict:
        """track when downloads start and simulate network delay."""
        download_times.append(asyncio.get_event_loop().time())
        # signal that at least one download has started
        download_start_event.set()
        # simulate network delay
        await asyncio.sleep(0.1)
        # return mock response with async body
        body = AsyncMock()
        body.iter_chunks = lambda: async_chunk_gen()
        return {"Body": body}

    async def async_chunk_gen():
        yield b"mock audio data"

    # create mock tracks
    mock_tracks = []
    for i in range(4):
        track = MagicMock()
        track.id = i
        track.title = f"Track {i}"
        track.file_id = f"file_{i}"
        track.file_type = "mp3"
        mock_tracks.append(track)

    # mock database query
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = mock_tracks

    mock_db = AsyncMock()
    mock_db.execute.return_value = mock_result

    # mock S3 client
    mock_s3 = AsyncMock()
    mock_s3.get_object = mock_get_object

    # mock session that returns mock s3 client
    mock_session = MagicMock()
    mock_session.client.return_value.__aenter__.return_value = mock_s3

    # mock job service
    mock_job_service = AsyncMock()

    # mock aiofiles.open to be a no-op
    mock_file = AsyncMock()
    mock_file.__aenter__.return_value = mock_file
    mock_file.__aexit__.return_value = None
    mock_file.write = AsyncMock()

    with (
        patch(
            "backend._internal.background_tasks.aioboto3.Session",
            return_value=mock_session,
        ),
        patch(
            "backend._internal.background_tasks.aiofiles.open", return_value=mock_file
        ),
        patch("backend._internal.background_tasks.zipfile.ZipFile"),
        patch("backend._internal.background_tasks.os.unlink"),
        patch("backend.utilities.database.db_session") as mock_db_session,
        patch("backend._internal.jobs.job_service", mock_job_service),
    ):
        mock_db_session.return_value.__aenter__.return_value = mock_db

        # run process_export but cancel before upload phase
        # (we only care about testing download concurrency)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(
                bg_tasks.process_export("export-123", "did:plc:testuser"),
                timeout=2.0,
            )

    # verify downloads started concurrently:
    # if sequential, each download would start ~0.1s after the previous
    # if concurrent, all 4 downloads should start within ~0.05s of each other
    assert len(download_times) == 4, f"expected 4 downloads, got {len(download_times)}"

    # check that all downloads started within a small time window (concurrent)
    # not spread out over 0.4s (sequential)
    time_spread = max(download_times) - min(download_times)
    assert time_spread < 0.1, (
        f"downloads should start concurrently (within 0.1s), "
        f"but time spread was {time_spread:.3f}s - likely still sequential"
    )

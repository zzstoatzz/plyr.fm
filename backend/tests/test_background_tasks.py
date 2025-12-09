"""tests for background task scheduling."""

from unittest.mock import MagicMock, patch

import backend._internal.background_tasks as bg_tasks


async def test_schedule_export_uses_docket_when_enabled() -> None:
    """when docket is enabled, schedule_export should add task to docket."""
    calls: list[tuple[str, str]] = []

    async def mock_schedule(export_id: str, artist_did: str) -> None:
        calls.append((export_id, artist_did))

    mock_docket = MagicMock()
    mock_docket.add = MagicMock(return_value=mock_schedule)

    with (
        patch.object(bg_tasks, "is_docket_enabled", return_value=True),
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "process_export", MagicMock()),
    ):
        await bg_tasks.schedule_export("export-123", "did:plc:testuser")

        mock_docket.add.assert_called_once()
        assert calls == [("export-123", "did:plc:testuser")]


async def test_schedule_export_falls_back_to_asyncio_when_disabled() -> None:
    """when docket is disabled, schedule_export should use asyncio.create_task."""
    create_task_calls: list[object] = []

    def capture_create_task(coro: object) -> MagicMock:
        create_task_calls.append(coro)
        return MagicMock()

    process_export_calls: list[tuple[str, str]] = []

    def mock_process_export(export_id: str, artist_did: str) -> object:
        process_export_calls.append((export_id, artist_did))
        return MagicMock()  # return non-coroutine to avoid unawaited warning

    with (
        patch.object(bg_tasks, "is_docket_enabled", return_value=False),
        patch.object(bg_tasks, "process_export", mock_process_export),
        patch.object(bg_tasks.asyncio, "create_task", capture_create_task),
    ):
        await bg_tasks.schedule_export("export-456", "did:plc:testuser")

        assert len(create_task_calls) == 1
        assert process_export_calls == [("export-456", "did:plc:testuser")]


async def test_schedule_export_falls_back_on_docket_error() -> None:
    """if docket scheduling fails, should fall back to asyncio."""
    mock_docket = MagicMock()
    mock_docket.add.side_effect = Exception("redis connection failed")

    create_task_calls: list[object] = []

    def capture_create_task(coro: object) -> MagicMock:
        create_task_calls.append(coro)
        return MagicMock()

    process_export_calls: list[tuple[str, str]] = []

    def mock_process_export(export_id: str, artist_did: str) -> object:
        process_export_calls.append((export_id, artist_did))
        return MagicMock()

    with (
        patch.object(bg_tasks, "is_docket_enabled", return_value=True),
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "process_export", mock_process_export),
        patch.object(bg_tasks.asyncio, "create_task", capture_create_task),
    ):
        await bg_tasks.schedule_export("export-789", "did:plc:testuser")

        assert len(create_task_calls) == 1


async def test_schedule_copyright_scan_uses_docket_when_enabled() -> None:
    """when docket is enabled, schedule_copyright_scan should add task to docket."""
    calls: list[tuple[int, str]] = []

    async def mock_schedule(track_id: int, audio_url: str) -> None:
        calls.append((track_id, audio_url))

    mock_docket = MagicMock()
    mock_docket.add = MagicMock(return_value=mock_schedule)

    with (
        patch.object(bg_tasks, "is_docket_enabled", return_value=True),
        patch.object(bg_tasks, "get_docket", return_value=mock_docket),
        patch.object(bg_tasks, "scan_copyright", MagicMock()),
    ):
        await bg_tasks.schedule_copyright_scan(123, "https://example.com/audio.mp3")

        mock_docket.add.assert_called_once()
        assert calls == [(123, "https://example.com/audio.mp3")]


async def test_schedule_copyright_scan_falls_back_to_asyncio_when_disabled() -> None:
    """when docket is disabled, schedule_copyright_scan should use asyncio."""
    create_task_calls: list[object] = []

    def capture_create_task(coro: object) -> MagicMock:
        create_task_calls.append(coro)
        return MagicMock()

    scan_calls: list[tuple[int, str]] = []

    def mock_scan(track_id: int, audio_url: str) -> object:
        scan_calls.append((track_id, audio_url))
        return MagicMock()

    with (
        patch.object(bg_tasks, "is_docket_enabled", return_value=False),
        patch("backend._internal.moderation.scan_track_for_copyright", mock_scan),
        patch.object(bg_tasks.asyncio, "create_task", capture_create_task),
    ):
        await bg_tasks.schedule_copyright_scan(456, "https://example.com/audio.mp3")

        assert len(create_task_calls) == 1
        assert scan_calls == [(456, "https://example.com/audio.mp3")]

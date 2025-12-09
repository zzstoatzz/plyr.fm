"""tests for background task scheduling."""

from unittest.mock import MagicMock, patch

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

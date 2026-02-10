"""test notification settings."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import Settings
from backend.models import Artist, Track


def test_notification_settings_from_env(monkeypatch: pytest.MonkeyPatch):
    """test that notification settings load from environment variables."""
    monkeypatch.setenv("NOTIFY_ENABLED", "true")
    monkeypatch.setenv("NOTIFY_RECIPIENT_HANDLE", "test.bsky.social")
    monkeypatch.setenv("NOTIFY_BOT_HANDLE", "bot.bsky.social")
    monkeypatch.setenv("NOTIFY_BOT_PASSWORD", "secret123")

    settings = Settings()

    assert settings.notify.enabled is True
    assert settings.notify.recipient_handle == "test.bsky.social"
    assert settings.notify.bot.handle == "bot.bsky.social"
    assert settings.notify.bot.password == "secret123"


def test_notification_settings_can_be_disabled(monkeypatch: pytest.MonkeyPatch):
    """test that notification settings can be explicitly disabled."""
    monkeypatch.setenv("NOTIFY_ENABLED", "false")
    monkeypatch.setenv("NOTIFY_RECIPIENT_HANDLE", "")
    monkeypatch.setenv("NOTIFY_BOT_HANDLE", "")
    monkeypatch.setenv("NOTIFY_BOT_PASSWORD", "")

    settings = Settings()

    assert settings.notify.enabled is False


async def test_track_notification_sent_flag_prevents_duplicates(db_session):
    """test that notification_sent flag prevents duplicate notifications."""
    # create test artist
    artist = Artist(
        did="did:plc:test123",
        handle="test.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()

    # create a track that hasn't been notified
    track = Track(
        title="Test Track",
        file_id="test_file_id",
        file_type="audio/mpeg",
        artist_did=artist.did,
        notification_sent=False,
    )
    db_session.add(track)
    await db_session.commit()
    track_id = track.id

    # verify track is initially marked as not notified
    await db_session.refresh(track)
    assert track.notification_sent is False

    # simulate notification being sent
    track.notification_sent = True
    await db_session.commit()

    # verify track is now marked as notified
    await db_session.refresh(track)
    assert track.notification_sent is True

    # query for tracks that need notification (should exclude our track)
    check_since = datetime.now(UTC)
    stmt = (
        select(Track)
        .where(Track.created_at > check_since)
        .where(Track.notification_sent == False)  # noqa: E712
    )
    result = await db_session.execute(stmt)
    tracks_needing_notification = result.scalars().all()

    # our track should not appear in this list since notification_sent=True
    assert track_id not in [t.id for t in tracks_needing_notification]


async def test_send_track_notification_refetches_from_session(
    db_session: AsyncSession,
) -> None:
    """regression: _send_track_notification must re-fetch the track by ID.

    previously it accepted a Track object and called db.refresh(), which failed
    with 'Instance is not persistent within this Session' when the track was
    created in a different session (the normal upload flow).
    """
    from backend.api.tracks.uploads import _send_track_notification

    artist = Artist(
        did="did:plc:notif_test",
        handle="notif.test.social",
        display_name="Notif Artist",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Detached Track",
        file_id="notif_test_file",
        file_type="audio/mpeg",
        artist_did=artist.did,
        notification_sent=False,
    )
    db_session.add(track)
    await db_session.commit()
    track_id = track.id

    mock_service = AsyncMock()
    mock_service.send_track_notification = AsyncMock(return_value=None)

    with (
        patch(
            "backend.api.tracks.uploads.notification_service", mock_service, create=True
        ),
        patch("backend._internal.notifications.notification_service", mock_service),
    ):
        # this used to raise DetachedInstanceError
        await _send_track_notification(db_session, track_id)

    mock_service.send_track_notification.assert_called_once()
    called_track = mock_service.send_track_notification.call_args[0][0]
    assert called_track.id == track_id
    assert called_track.title == "Detached Track"

    await db_session.refresh(track)
    assert track.notification_sent is True

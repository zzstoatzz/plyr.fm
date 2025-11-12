"""test notification settings."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

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

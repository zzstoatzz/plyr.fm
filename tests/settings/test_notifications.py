"""test notification settings."""

import pytest

from relay.config import NotificationSettings, Settings


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


def test_notification_settings_defaults():
    """test default notification settings."""
    settings = NotificationSettings()

    assert settings.enabled is False
    assert settings.recipient_handle == ""
    assert settings.bot.handle == ""
    assert settings.bot.password == ""

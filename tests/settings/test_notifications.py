"""test notification settings."""

import pytest

from backend.config import Settings


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

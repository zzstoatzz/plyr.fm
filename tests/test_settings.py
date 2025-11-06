import pytest

from backend.config import Settings


@pytest.fixture(autouse=True)
def clear_settings_env(monkeypatch):
    env_vars = [
        "PORT",
        "FRONTEND_URL",
        "BACKGROUND_TASK_INTERVAL_SECONDS",
        "DATABASE_URL",
        "STORAGE_BACKEND",
        "R2_BUCKET",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "R2_ENDPOINT_URL",
        "R2_PUBLIC_BUCKET_URL",
        "ATPROTO_CLIENT_ID",
        "ATPROTO_SCOPE_OVERRIDE",
        "ATPROTO_REDIRECT_URI",
        "OAUTH_ENCRYPTION_KEY",
        "LOGFIRE_ENABLED",
        "LOGFIRE_WRITE_TOKEN",
        "NOTIFY_ENABLED",
        "NOTIFY_RECIPIENT_HANDLE",
        "NOTIFY_BOT_HANDLE",
        "NOTIFY_BOT_PASSWORD",
        "BROADCAST_CHANNEL_PREFIX",
    ]

    for var in env_vars:
        monkeypatch.delenv(var, raising=False)


def test_settings_loads_env(monkeypatch):
    monkeypatch.setenv("PORT", "9100")
    monkeypatch.setenv("FRONTEND_URL", "https://relay.example.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@host/db")
    monkeypatch.setenv("STORAGE_BACKEND", "r2")
    monkeypatch.setenv("R2_BUCKET", "media")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("ATPROTO_CLIENT_ID", "https://client/meta.json")
    monkeypatch.setenv("ATPROTO_REDIRECT_URI", "https://relay.example.com/callback")
    monkeypatch.setenv("OAUTH_ENCRYPTION_KEY", "Z2V0LXlvdXItb3duLWRhbS1rZXk=")
    monkeypatch.setenv("LOGFIRE_ENABLED", "true")
    monkeypatch.setenv("LOGFIRE_WRITE_TOKEN", "pylf_token")
    monkeypatch.setenv("NOTIFY_ENABLED", "true")
    monkeypatch.setenv("NOTIFY_RECIPIENT_HANDLE", "relay.example")
    monkeypatch.setenv("NOTIFY_BOT_HANDLE", "bot.handle")
    monkeypatch.setenv("NOTIFY_BOT_PASSWORD", "secret")

    settings = Settings()

    assert settings.app.port == 9100
    assert settings.frontend.url == "https://relay.example.com"
    assert settings.database.url == "postgresql+psycopg://user:pass@host/db"
    assert settings.storage.backend == "r2"
    assert settings.storage.r2_bucket == "media"
    assert settings.storage.aws_access_key_id == "key123"
    assert settings.atproto.client_id == "https://client/meta.json"
    assert settings.atproto.redirect_uri == "https://relay.example.com/callback"
    assert settings.atproto.oauth_encryption_key == "Z2V0LXlvdXItb3duLWRhbS1rZXk="
    assert settings.observability.enabled is True
    assert settings.observability.write_token == "pylf_token"
    assert settings.notify.enabled is True
    assert settings.notify.recipient_handle == "relay.example"
    assert settings.notify.bot.handle == "bot.handle"
    assert settings.notify.bot.password == "secret"


def test_settings_supports_nested_env(monkeypatch):
    monkeypatch.setenv("PORT", "9300")
    monkeypatch.setenv("BROADCAST_CHANNEL_PREFIX", "newprefix")
    monkeypatch.setenv("FRONTEND_URL", "https://cdn.example.com")
    monkeypatch.setenv("ATPROTO_CLIENT_ID", "https://new/meta.json")
    monkeypatch.setenv("ATPROTO_SCOPE_OVERRIDE", "custom scope")

    settings = Settings()

    assert settings.app.port == 9300
    assert settings.app.broadcast_channel_prefix == "newprefix"
    assert settings.frontend.url == "https://cdn.example.com"
    assert settings.atproto.client_id == "https://new/meta.json"
    assert settings.atproto.scope_override == "custom scope"

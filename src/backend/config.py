"""Relay configuration using nested Pydantic settings."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class RelaySettingsSection(BaseSettings):
    """Base class for all settings sections with shared defaults."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


class NotificationBotSettings(RelaySettingsSection):
    """Settings for the notification bot."""

    model_config = SettingsConfigDict(
        env_prefix="NOTIFY_BOT_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    handle: str = Field(default="", description="Bluesky handle for bot")
    password: str = Field(default="", description="App password for bot")


class NotificationSettings(RelaySettingsSection):
    """Settings for notifications."""

    model_config = SettingsConfigDict(
        env_prefix="NOTIFY_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(default=False, description="Enable notifications")
    recipient_handle: str = Field(
        default="", description="Bluesky handle to send notifications to"
    )
    bot: NotificationBotSettings = Field(
        default_factory=NotificationBotSettings,
        description="Bot credentials for sending DMs",
    )


class AppSettings(RelaySettingsSection):
    """Core application configuration."""

    name: str = Field(
        default="plyr.fm",
        description="Public-facing application name",
    )
    tagline: str = Field(
        default="music streaming on atproto",
        description="Short marketing tagline for metadata",
    )
    debug: bool = Field(
        default=False,
        description="Enable debug mode",
    )
    port: int = Field(
        default=8001,
        validation_alias="PORT",
        description="Server port",
    )
    background_task_interval_seconds: int = Field(
        default=60,
        description="Interval for background tasks in seconds",
    )
    canonical_host: str = Field(
        default="plyr.fm",
        description="Canonical host used for metadata and share links",
    )
    canonical_url_override: str | None = Field(
        default=None,
        description="Override canonical URL if it differs from https://{canonical_host}",
    )
    broadcast_channel_prefix: str = Field(
        default="plyr",
        description="Prefix used for browser BroadcastChannel identifiers",
    )

    @computed_field
    @property
    def canonical_url(self) -> str:
        """Canonical site URL for metadata/share links."""

        if self.canonical_url_override:
            return self.canonical_url_override.rstrip("/")

        scheme = "https"
        if self.canonical_host.startswith(
            "localhost"
        ) or self.canonical_host.startswith("127.0.0.1"):
            scheme = "http"
        return f"{scheme}://{self.canonical_host}".rstrip("/")


class FrontendSettings(RelaySettingsSection):
    """Frontend-specific configuration."""

    url: str = Field(
        default="http://localhost:5173",
        validation_alias="FRONTEND_URL",
        description="Frontend URL for redirects",
    )
    cors_origin_regex: str | None = Field(
        default=None,
        validation_alias="FRONTEND_CORS_ORIGIN_REGEX",
        description="CORS origin regex pattern (if not set, uses default for plyr.fm and relay-4i6.pages.dev)",
    )

    @computed_field
    @property
    def resolved_cors_origin_regex(self) -> str:
        """Resolved CORS origin regex pattern."""
        if self.cors_origin_regex is not None:
            return self.cors_origin_regex

        # default: allow localhost for dev + plyr.fm + cloudflare pages (including preview deployments)
        return r"^(https://(www\.)?plyr\.fm|https://([a-z0-9]+\.)?relay-4i6\.pages\.dev|http://localhost:5173)$"


class DatabaseSettings(RelaySettingsSection):
    """Database configuration."""

    url: str = Field(
        default="postgresql+asyncpg://localhost/plyr",
        validation_alias="DATABASE_URL",
        description="PostgreSQL connection string",
    )


class StorageSettings(RelaySettingsSection):
    """Asset storage configuration."""

    backend: str = Field(
        default="filesystem",
        validation_alias="STORAGE_BACKEND",
        description="Storage backend (filesystem or r2)",
    )
    aws_access_key_id: str = Field(
        default="",
        validation_alias="AWS_ACCESS_KEY_ID",
        description="AWS access key ID",
    )
    aws_secret_access_key: str = Field(
        default="",
        validation_alias="AWS_SECRET_ACCESS_KEY",
        description="AWS secret access key",
    )
    r2_bucket: str = Field(
        default="",
        validation_alias="R2_BUCKET",
        description="R2 bucket name",
    )
    r2_endpoint_url: str = Field(
        default="",
        validation_alias="R2_ENDPOINT_URL",
        description="R2 endpoint URL",
    )
    r2_public_bucket_url: str = Field(
        default="",
        validation_alias="R2_PUBLIC_BUCKET_URL",
        description="R2 public bucket URL",
    )


class AtprotoSettings(RelaySettingsSection):
    """ATProto integration settings."""

    pds_url: str = Field(
        default="https://bsky.social",
        validation_alias="ATPROTO_PDS_URL",
        description="ATProto PDS URL",
    )
    client_id: str = Field(
        default="",
        validation_alias="ATPROTO_CLIENT_ID",
        description="OAuth client ID",
    )
    client_secret: str = Field(
        default="",
        validation_alias="ATPROTO_CLIENT_SECRET",
        description="OAuth client secret",
    )
    redirect_uri: str = Field(
        default="http://localhost:8000/auth/callback",
        validation_alias="ATPROTO_REDIRECT_URI",
        description="OAuth redirect URI",
    )
    app_namespace: str = Field(
        default="fm.plyr",
        validation_alias="ATPROTO_APP_NAMESPACE",
        description="ATProto app namespace used for record collections",
    )
    old_app_namespace: str | None = Field(
        default=None,
        validation_alias="ATPROTO_OLD_APP_NAMESPACE",
        description="Optional previous ATProto namespace for migration (e.g., 'app.relay'). When set, OAuth scopes will include both old and new namespaces.",
    )
    scope_override: str | None = Field(
        default=None,
        validation_alias="ATPROTO_SCOPE_OVERRIDE",
        description="Optional OAuth scope override",
    )
    oauth_encryption_key: str = Field(
        default="",
        validation_alias="OAUTH_ENCRYPTION_KEY",
        description="Fernet encryption key for OAuth data at rest",
    )

    @computed_field
    @property
    def track_collection(self) -> str:
        """Collection name for plyr audio records."""

        return f"{self.app_namespace}.track"

    @computed_field
    @property
    def old_track_collection(self) -> str | None:
        """Collection name for old namespace, if migration is active."""

        if self.old_app_namespace:
            return f"{self.old_app_namespace}.track"
        return None

    @computed_field
    @property
    def resolved_scope(self) -> str:
        """OAuth scope, falling back to the repo scope for the configured namespace(s)."""

        if self.scope_override:
            return self.scope_override

        # if we have an old namespace, request access to both collections
        if self.old_app_namespace:
            return (
                f"atproto repo:{self.track_collection} repo:{self.old_track_collection}"
            )

        return f"atproto repo:{self.track_collection}"


class ObservabilitySettings(RelaySettingsSection):
    """Observability configuration."""

    enabled: bool = Field(
        default=False,
        validation_alias="LOGFIRE_ENABLED",
        description="Enable Logfire OTEL",
    )
    write_token: str = Field(
        default="",
        validation_alias="LOGFIRE_WRITE_TOKEN",
        description="Logfire write token",
    )
    environment: str = Field(
        default="local",
        validation_alias="LOGFIRE_ENVIRONMENT",
        description="Logfire environment (local/production)",
    )


class Settings(RelaySettingsSection):
    """Relay application settings."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_nested_delimiter="__",
    )

    app: AppSettings = Field(default_factory=AppSettings)
    frontend: FrontendSettings = Field(default_factory=FrontendSettings)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)
    atproto: AtprotoSettings = Field(default_factory=AtprotoSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)
    notify: NotificationSettings = Field(
        default_factory=NotificationSettings,
        description="Notification settings",
    )


settings = Settings()

"""Relay configuration using nested Pydantic settings."""

from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field, computed_field
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
        default="relay",
        validation_alias=AliasChoices("APP_NAME", "NAME"),
        description="Public-facing application name",
    )
    tagline: str = Field(
        default="music streaming on atproto",
        validation_alias=AliasChoices("APP_TAGLINE", "TAGLINE"),
        description="Short marketing tagline for metadata",
    )
    debug: bool = Field(
        default=False,
        validation_alias=AliasChoices("APP_DEBUG", "DEBUG"),
        description="Enable debug mode",
    )
    port: int = Field(
        default=8001,
        validation_alias=AliasChoices("PORT", "APP_PORT", "APP__PORT"),
        description="Server port",
    )
    background_task_interval_seconds: int = Field(
        default=60,
        validation_alias=AliasChoices(
            "BACKGROUND_TASK_INTERVAL_SECONDS",
            "APP_BACKGROUND_TASK_INTERVAL_SECONDS",
            "APP__BACKGROUND_TASK_INTERVAL_SECONDS",
        ),
        description="Interval for background tasks in seconds",
    )
    canonical_host: str = Field(
        default="relay.zzstoatzz.io",
        validation_alias=AliasChoices("CANONICAL_HOST", "APP_CANONICAL_HOST"),
        description="Canonical host used for metadata and share links",
    )
    canonical_url_override: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "CANONICAL_URL_OVERRIDE",
            "APP_CANONICAL_URL_OVERRIDE",
            "APP__CANONICAL_URL_OVERRIDE",
        ),
        description="Override canonical URL if it differs from https://{canonical_host}",
    )
    broadcast_channel_prefix: str = Field(
        default="relay",
        validation_alias=AliasChoices(
            "BROADCAST_CHANNEL_PREFIX",
            "APP_BROADCAST_CHANNEL_PREFIX",
            "APP__BROADCAST_CHANNEL_PREFIX",
        ),
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
        validation_alias=AliasChoices("FRONTEND_URL", "FRONTEND__URL"),
        description="Frontend URL for redirects",
    )
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173"],
        validation_alias=AliasChoices("FRONTEND_CORS_ORIGINS", "CORS_ORIGINS"),
        description="CORS allowed origins",
    )


class DatabaseSettings(RelaySettingsSection):
    """Database configuration."""

    url: str = Field(
        default="postgresql+asyncpg://localhost/relay",
        validation_alias=AliasChoices("DATABASE_URL", "URL"),
        description="PostgreSQL connection string",
    )


class RedisSettings(RelaySettingsSection):
    """Redis configuration."""

    url: str = Field(
        default="redis://localhost:6379/0",
        validation_alias=AliasChoices("REDIS_URL", "URL"),
        description="Redis connection string",
    )


class StorageSettings(RelaySettingsSection):
    """Asset storage configuration."""

    backend: str = Field(
        default="filesystem",
        validation_alias=AliasChoices("STORAGE_BACKEND", "BACKEND"),
        description="Storage backend (filesystem or r2)",
    )
    aws_access_key_id: str = Field(
        default="",
        validation_alias=AliasChoices("STORAGE_AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
        description="AWS access key ID",
    )
    aws_secret_access_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "STORAGE_AWS_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"
        ),
        description="AWS secret access key",
    )
    r2_bucket: str = Field(
        default="",
        validation_alias=AliasChoices("STORAGE_R2_BUCKET", "R2_BUCKET"),
        description="R2 bucket name",
    )
    r2_endpoint_url: str = Field(
        default="",
        validation_alias=AliasChoices("STORAGE_R2_ENDPOINT_URL", "R2_ENDPOINT_URL"),
        description="R2 endpoint URL",
    )
    r2_public_bucket_url: str = Field(
        default="",
        validation_alias=AliasChoices(
            "STORAGE_R2_PUBLIC_BUCKET_URL", "R2_PUBLIC_BUCKET_URL"
        ),
        description="R2 public bucket URL",
    )


class AtprotoSettings(RelaySettingsSection):
    """ATProto integration settings."""

    pds_url: str = Field(
        default="https://bsky.social",
        validation_alias=AliasChoices("ATPROTO_PDS_URL", "ATPROTO__PDS_URL", "PDS_URL"),
        description="ATProto PDS URL",
    )
    client_id: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ATPROTO_CLIENT_ID", "ATPROTO__CLIENT_ID", "CLIENT_ID"
        ),
        description="OAuth client ID",
    )
    client_secret: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ATPROTO_CLIENT_SECRET", "ATPROTO__CLIENT_SECRET", "CLIENT_SECRET"
        ),
        description="OAuth client secret",
    )
    redirect_uri: str = Field(
        default="http://localhost:8000/auth/callback",
        validation_alias=AliasChoices(
            "ATPROTO_REDIRECT_URI", "ATPROTO__REDIRECT_URI", "REDIRECT_URI"
        ),
        description="OAuth redirect URI",
    )
    app_namespace: str = Field(
        default="app.relay",
        validation_alias=AliasChoices(
            "ATPROTO_APP_NAMESPACE", "ATPROTO__APP_NAMESPACE", "APP_NAMESPACE"
        ),
        description="ATProto app namespace used for record collections",
    )
    scope_override: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "ATPROTO_SCOPE_OVERRIDE",
            "ATPROTO__SCOPE_OVERRIDE",
            "ATPROTO_SCOPE",
            "SCOPE_OVERRIDE",
        ),
        description="Optional OAuth scope override",
    )
    oauth_encryption_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ATPROTO_OAUTH_ENCRYPTION_KEY",
            "ATPROTO__OAUTH_ENCRYPTION_KEY",
            "OAUTH_ENCRYPTION_KEY",
        ),
        description="Fernet encryption key for OAuth data at rest",
    )

    @computed_field
    @property
    def track_collection(self) -> str:
        """Collection name for relay audio records."""

        return f"{self.app_namespace}.track"

    @computed_field
    @property
    def resolved_scope(self) -> str:
        """OAuth scope, falling back to the repo scope for the configured namespace."""

        if self.scope_override:
            return self.scope_override
        return f"atproto repo:{self.track_collection}"


class ObservabilitySettings(RelaySettingsSection):
    """Observability configuration."""

    enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "LOGFIRE_ENABLED",
            "LOGFIRE__ENABLED",
            "ENABLED",
        ),
        description="Enable Logfire OTEL",
    )
    write_token: str = Field(
        default="",
        validation_alias=AliasChoices(
            "LOGFIRE_WRITE_TOKEN",
            "LOGFIRE__WRITE_TOKEN",
            "WRITE_TOKEN",
        ),
        description="Logfire write token",
    )
    environment: str = Field(
        default="local",
        validation_alias=AliasChoices(
            "LOGFIRE_ENVIRONMENT",
            "LOGFIRE__ENVIRONMENT",
            "ENVIRONMENT",
        ),
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
    redis: RedisSettings = Field(default_factory=RedisSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)
    atproto: AtprotoSettings = Field(default_factory=AtprotoSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)
    notify: NotificationSettings = Field(
        default_factory=NotificationSettings,
        description="Notification settings",
    )

    # ------------------------------------------------------------------
    # Compatibility accessors for legacy callsites
    # ------------------------------------------------------------------

    @property
    def app_name(self) -> str:
        return self.app.name

    @property
    def app_tagline(self) -> str:
        return self.app.tagline

    @property
    def debug(self) -> bool:
        return self.app.debug

    @property
    def port(self) -> int:
        return self.app.port

    @property
    def background_task_interval_seconds(self) -> int:
        return self.app.background_task_interval_seconds

    @property
    def canonical_host(self) -> str:
        return self.app.canonical_host

    @property
    def canonical_url_override(self) -> str | None:
        return self.app.canonical_url_override

    @property
    def canonical_url(self) -> str:
        return self.app.canonical_url

    @property
    def broadcast_channel_prefix(self) -> str:
        return self.app.broadcast_channel_prefix

    @property
    def frontend_url(self) -> str:
        return self.frontend.url

    @property
    def cors_origins(self) -> list[str]:
        return self.frontend.cors_origins

    @property
    def database_url(self) -> str:
        return self.database.url

    @property
    def redis_url(self) -> str:
        return self.redis.url

    @property
    def storage_backend(self) -> str:
        return self.storage.backend

    @property
    def aws_access_key_id(self) -> str:
        return self.storage.aws_access_key_id

    @property
    def aws_secret_access_key(self) -> str:
        return self.storage.aws_secret_access_key

    @property
    def r2_bucket(self) -> str:
        return self.storage.r2_bucket

    @property
    def r2_endpoint_url(self) -> str:
        return self.storage.r2_endpoint_url

    @property
    def r2_public_bucket_url(self) -> str:
        return self.storage.r2_public_bucket_url

    @property
    def atproto_pds_url(self) -> str:
        return self.atproto.pds_url

    @property
    def atproto_client_id(self) -> str:
        return self.atproto.client_id

    @property
    def atproto_client_secret(self) -> str:
        return self.atproto.client_secret

    @property
    def atproto_redirect_uri(self) -> str:
        return self.atproto.redirect_uri

    @property
    def atproto_app_namespace(self) -> str:
        return self.atproto.app_namespace

    @property
    def atproto_scope_override(self) -> str | None:
        return self.atproto.scope_override

    @property
    def atproto_track_collection(self) -> str:
        return self.atproto.track_collection

    @property
    def resolved_atproto_scope(self) -> str:
        return self.atproto.resolved_scope

    @property
    def oauth_encryption_key(self) -> str:
        return self.atproto.oauth_encryption_key

    @property
    def logfire_enabled(self) -> bool:
        return self.observability.enabled

    @property
    def logfire_write_token(self) -> str:
        return self.observability.write_token

    @property
    def logfire_environment(self) -> str:
        return self.observability.environment


settings = Settings()

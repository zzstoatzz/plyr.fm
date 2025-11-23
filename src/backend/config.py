"""Relay configuration using nested Pydantic settings."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

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
    broadcast_channel_prefix: str = Field(
        default="plyr",
        description="Prefix used for browser BroadcastChannel identifiers",
    )


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

        # derive allowed origins based on FRONTEND_URL
        # production: FRONTEND_URL=https://plyr.fm → allow plyr.fm + www.plyr.fm
        # staging: FRONTEND_URL=https://stg.plyr.fm → allow stg.plyr.fm
        # always allow localhost for local dev and cloudflare preview deployments

        from urllib.parse import urlparse

        parsed = urlparse(self.url)
        hostname = parsed.hostname or "localhost"

        if hostname == "stg.plyr.fm":
            # staging: allow stg.plyr.fm
            return r"^(https://stg\.plyr\.fm|https://([a-z0-9]+\.)?relay-4i6\.pages\.dev|http://localhost:5173)$"
        elif hostname in ("plyr.fm", "www.plyr.fm"):
            # production: allow plyr.fm and www.plyr.fm
            return r"^(https://(www\.)?plyr\.fm|https://([a-z0-9]+\.)?relay-4i6\.pages\.dev|http://localhost:5173)$"
        else:
            # local dev: allow localhost
            return r"^(http://localhost:5173)$"


class DatabaseSettings(RelaySettingsSection):
    """Database configuration."""

    url: str = Field(
        default="postgresql+asyncpg://localhost/plyr",
        validation_alias="DATABASE_URL",
        description="PostgreSQL connection string",
    )

    # timeouts
    statement_timeout: float = Field(
        default=10.0,
        validation_alias="DATABASE_STATEMENT_TIMEOUT",
        description="Timeout in seconds for SQL statement execution. Prevents runaway queries from holding connections indefinitely.",
    )
    connection_timeout: float = Field(
        default=3.0,
        validation_alias="DATABASE_CONNECTION_TIMEOUT",
        description="Timeout in seconds for establishing database connections. Fails fast when database is slow or unresponsive.",
    )
    queue_connect_timeout: float = Field(
        default=15.0,
        validation_alias="QUEUE_CONNECT_TIMEOUT",
        description="Timeout in seconds for queue listener database connections",
    )

    # connection pool settings
    pool_size: int = Field(
        default=5,
        validation_alias="DATABASE_POOL_SIZE",
        description="Number of database connections to keep in the pool at all times.",
    )
    pool_max_overflow: int = Field(
        default=0,
        validation_alias="DATABASE_MAX_OVERFLOW",
        description="Maximum connections to create beyond pool_size when pool is exhausted. Total max connections = pool_size + pool_max_overflow.",
    )
    pool_recycle: int = Field(
        default=7200,
        validation_alias="DATABASE_POOL_RECYCLE",
        description="Seconds before recycling a connection. Prevents stale connections from lingering. Default 2 hours.",
    )
    pool_pre_ping: bool = Field(
        default=True,
        validation_alias="DATABASE_POOL_PRE_PING",
        description="Verify connection health before using from pool. Adds small overhead but prevents using dead connections.",
    )


class StorageSettings(RelaySettingsSection):
    """Asset storage configuration (R2 only)."""

    max_upload_size_mb: int = Field(
        default=1536,  # 1.5GB - supports 2-hour WAV (worst case) with headroom
        validation_alias="MAX_UPLOAD_SIZE_MB",
        description="Maximum file upload size in megabytes",
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
        description="R2 bucket name for audio files",
    )
    r2_image_bucket: str = Field(
        default="",
        validation_alias="R2_IMAGE_BUCKET",
        description="R2 bucket name for image files",
    )
    r2_endpoint_url: str = Field(
        default="",
        validation_alias="R2_ENDPOINT_URL",
        description="R2 endpoint URL",
    )
    r2_public_bucket_url: str = Field(
        default="",
        validation_alias="R2_PUBLIC_BUCKET_URL",
        description="R2 public bucket URL for audio files",
    )
    r2_public_image_bucket_url: str = Field(
        default="",
        validation_alias="R2_PUBLIC_IMAGE_BUCKET_URL",
        description="R2 public bucket URL for image files",
    )

    @computed_field
    @property
    def allowed_image_origins(self) -> set[str]:
        """Origins allowed for imageUrl validation."""
        origins = set()
        if self.r2_public_image_bucket_url:
            parsed = urlparse(self.r2_public_image_bucket_url)
            origins.add(f"{parsed.scheme}://{parsed.netloc}")
        return origins

    def validate_image_url(self, url: str | None) -> bool:
        """Validate that imageUrl comes from allowed origin.

        args:
            url: image URL to validate

        returns:
            True if valid or None, raises ValueError if invalid

        raises:
            ValueError: if URL is from untrusted origin
        """
        if not url:
            return True

        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        if origin not in self.allowed_image_origins:
            raise ValueError(
                f"image must be hosted on allowed origins: {self.allowed_image_origins}"
            )

        return True


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
    def like_collection(self) -> str:
        """Collection name for like records."""

        return f"{self.app_namespace}.like"

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

        # base scopes: our track collection + our like collection
        scopes = [
            f"repo:{self.track_collection}",
            f"repo:{self.like_collection}",
        ]

        # if we have an old namespace, add old track collection too
        if self.old_app_namespace:
            scopes.append(f"repo:{self.old_track_collection}")

        return f"atproto {' '.join(scopes)}"


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


class RateLimitSettings(RelaySettingsSection):
    """Rate limiting configuration."""

    model_config = SettingsConfigDict(
        env_prefix="RATE_LIMIT_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=True,
        description="Enable API rate limiting",
    )
    default_limit: str = Field(
        default="100/minute",
        description="Default global rate limit",
    )
    auth_limit: str = Field(
        default="10/minute",
        description="Rate limit for authentication endpoints",
    )
    upload_limit: str = Field(
        default="5/minute",
        description="Rate limit for file uploads",
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
    rate_limit: RateLimitSettings = Field(
        default_factory=RateLimitSettings,
        description="Rate limiting settings",
    )
    notify: NotificationSettings = Field(
        default_factory=NotificationSettings,
        description="Notification settings",
    )


settings = Settings()

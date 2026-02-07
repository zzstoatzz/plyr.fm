"""plyr.fm configuration using nested Pydantic settings."""

from __future__ import annotations

from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Annotated, Any, TypeVar
from urllib.parse import urlparse

from pydantic import (
    AnyHttpUrl,
    BeforeValidator,
    Field,
    SecretStr,
    TypeAdapter,
    computed_field,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

T = TypeVar("T")


def validate_set_T_from_delim_string(
    value: str | T | set[T] | None, type_: Any, delim: str | None = None
) -> set[T]:
    """Parse comma-delimited string into a set.

    e.g. `BUFO_EXCLUDE_PATTERNS=bigbufo*,other*` -> `{"bigbufo*", "other*"}`
    """
    if not value:
        return set()

    adapter = TypeAdapter(type_)
    delim = delim or ","
    if isinstance(value, str):
        return {adapter.validate_strings(s.strip()) for s in value.split(delim)}
    try:
        return {adapter.validate_python(value)}
    except Exception:
        pass
    try:
        return TypeAdapter(set[type_]).validate_python(value)
    except Exception:
        pass
    raise ValueError(f"invalid set[{type_}]: {value}")


CommaSeparatedStringSet = Annotated[
    str | set[str],
    BeforeValidator(partial(validate_set_T_from_delim_string, type_=str)),
]


class AppSettingsSection(BaseSettings):
    """Base class for all settings sections with shared defaults."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


class NotificationBotSettings(AppSettingsSection):
    """Settings for the notification bot."""

    model_config = SettingsConfigDict(
        env_prefix="NOTIFY_BOT_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    handle: str = Field(default="", description="Bluesky handle for bot")
    password: str = Field(default="", description="App password for bot")


class NotificationSettings(AppSettingsSection):
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


class AppSettings(AppSettingsSection):
    """Core application configuration."""

    name: str = Field(
        default="plyr.fm",
        description="Public-facing application name",
    )
    tagline: str = Field(
        default="audio streaming app",
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
    default_page_size: int = Field(
        default=50,
        description="Default page size for paginated endpoints",
    )


class LegalSettings(AppSettingsSection):
    """Legal and contact configuration."""

    model_config = SettingsConfigDict(
        env_prefix="LEGAL_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    contact_email: str = Field(
        default="plyrdotfm@proton.me",
        description="General contact email",
    )
    privacy_email: str | None = Field(
        default=None,
        description="Privacy-specific contact email (falls back to contact_email)",
    )
    dmca_email: str | None = Field(
        default=None,
        description="DMCA/copyright contact email (falls back to contact_email)",
    )
    dmca_registration_number: str = Field(
        default="DMCA-1069186",
        description="USPTO DMCA agent registration number",
    )
    terms_last_updated: datetime = Field(
        default=datetime(2026, 2, 6),
        description="Date the terms/privacy were last materially updated. "
        "Users who accepted before this date will be prompted to re-accept.",
    )

    @computed_field
    @property
    def resolved_privacy_email(self) -> str:
        """Privacy email, falling back to contact_email."""
        return self.privacy_email or self.contact_email

    @computed_field
    @property
    def resolved_dmca_email(self) -> str:
        """DMCA email, falling back to contact_email."""
        return self.dmca_email or self.contact_email


class FrontendSettings(AppSettingsSection):
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
    def domain(self) -> str:
        """extract domain from frontend URL (e.g., 'plyr.fm', 'stg.plyr.fm')."""
        from urllib.parse import urlparse

        parsed = urlparse(self.url)
        return parsed.netloc or "plyr.fm"

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


class DatabaseSettings(AppSettingsSection):
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
        default=10.0,
        validation_alias="DATABASE_CONNECTION_TIMEOUT",
        description="Timeout in seconds for establishing database connections. Set higher than Neon cold start latency (~5-10s) to allow wake-up, but low enough to fail fast on true outages.",
    )
    queue_connect_timeout: float = Field(
        default=15.0,
        validation_alias="QUEUE_CONNECT_TIMEOUT",
        description="Timeout in seconds for queue listener database connections",
    )

    # connection pool settings
    # sized to handle Neon cold start scenarios where multiple requests arrive simultaneously
    # after idle period. with pool_size=10 + max_overflow=5, we can handle 15 concurrent
    # requests waiting for Neon to wake up without exhausting the pool.
    pool_size: int = Field(
        default=10,
        validation_alias="DATABASE_POOL_SIZE",
        description="Number of database connections to keep in the pool at all times.",
    )
    pool_max_overflow: int = Field(
        default=5,
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


class StorageSettings(AppSettingsSection):
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
    r2_private_bucket: str = Field(
        default="",
        validation_alias="R2_PRIVATE_BUCKET",
        description="R2 private bucket for supporter-gated audio (no public URL)",
    )
    presigned_url_expiry_seconds: int = Field(
        default=3600,
        validation_alias="PRESIGNED_URL_EXPIRY_SECONDS",
        description="Expiry time in seconds for presigned URLs (default 1 hour)",
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
    # dedicated stats bucket - shared across all environments
    costs_json_url: str = Field(
        default="https://pub-68f2c7379f204d81bdf65152b0ff0207.r2.dev/costs.json",
        validation_alias="COSTS_JSON_URL",
        description="URL for public costs dashboard JSON",
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


class AtprotoSettings(AppSettingsSection):
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
    use_permission_sets: bool = Field(
        default=False,
        validation_alias="ATPROTO_USE_PERMISSION_SETS",
        description="Use ATProto permission sets instead of granular repo scopes. Requires permission set lexicons to be published to the app namespace authority.",
    )
    oauth_encryption_key: str = Field(
        default="",
        validation_alias="OAUTH_ENCRYPTION_KEY",
        description="Fernet encryption key for OAuth data at rest",
    )
    oauth_jwk: str = Field(
        default="",
        validation_alias="OAUTH_JWK",
        description="JSON-serialized ES256 private key for confidential OAuth client. Generate with: uv run python scripts/gen_oauth_jwk.py",
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
    def comment_collection(self) -> str:
        """Collection name for timed comment records."""

        return f"{self.app_namespace}.comment"

    @computed_field
    @property
    def list_collection(self) -> str:
        """Collection name for list records (playlists, albums)."""

        return f"{self.app_namespace}.list"

    @computed_field
    @property
    def profile_collection(self) -> str:
        """Collection name for artist profile records."""

        return f"{self.app_namespace}.actor.profile"

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

        # use permission sets if enabled (requires lexicons to be published)
        # blob scope must be requested directly (can't be in permission sets)
        if self.use_permission_sets:
            return f"atproto blob:*/* include:{self.app_namespace}.authFullApp"

        # fallback: granular repo scopes for each collection
        scopes = [
            "blob:*/*",  # upload blobs to user's PDS
            f"repo:{self.track_collection}",
            f"repo:{self.like_collection}",
            f"repo:{self.comment_collection}",
            f"repo:{self.list_collection}",
            f"repo:{self.profile_collection}",
        ]

        # if we have an old namespace, add old track collection too
        if self.old_app_namespace:
            scopes.append(f"repo:{self.old_track_collection}")

        return f"atproto {' '.join(scopes)}"

    def resolved_scope_with_teal(self, teal_play: str, teal_status: str) -> str:
        """OAuth scope including teal.fm scrobbling permissions.

        args:
            teal_play: teal.fm play collection NSID (e.g., fm.teal.alpha.feed.play)
            teal_status: teal.fm status collection NSID (e.g., fm.teal.alpha.actor.status)
        """
        base = self.resolved_scope
        teal_scopes = [f"repo:{teal_play}", f"repo:{teal_status}"]
        return f"{base} {' '.join(teal_scopes)}"


class TealSettings(AppSettingsSection):
    """teal.fm integration settings for scrobbling.

    teal.fm is a music scrobbling service built on ATProto. when users enable
    scrobbling, plyr.fm writes play records to their PDS using teal's lexicons.

    these namespaces may change as teal.fm evolves from alpha to stable.
    configure via environment variables to adapt without code changes.
    """

    model_config = SettingsConfigDict(
        env_prefix="TEAL_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=True,
        description="Enable teal.fm scrobbling feature. When False, the toggle is hidden and no scrobbles are sent.",
    )
    play_collection: str = Field(
        default="fm.teal.alpha.feed.play",
        description="Lexicon NSID for teal.fm play records (scrobbles)",
    )
    status_collection: str = Field(
        default="fm.teal.alpha.actor.status",
        description="Lexicon NSID for teal.fm actor status (now playing)",
    )


class BufoSettings(AppSettingsSection):
    """Bufo easter egg configuration."""

    model_config = SettingsConfigDict(
        env_prefix="BUFO_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    exclude_patterns: CommaSeparatedStringSet = Field(
        default={"^bigbufo_"},
        description="Regex patterns for bufo names to exclude from the easter egg animation",
    )
    include_patterns: CommaSeparatedStringSet = Field(
        default={"bigbufo_0_0", "bigbufo_2_1"},
        description="Regex patterns to override exclusions (allowlist)",
    )


class ObservabilitySettings(AppSettingsSection):
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
    suppressed_loggers: CommaSeparatedStringSet = Field(
        default={"docket"},
        validation_alias="LOGFIRE_SUPPRESSED_LOGGERS",
        description="Logger names to suppress (set to WARNING level)",
    )


class ModerationSettings(AppSettingsSection):
    """Moderation service configuration."""

    model_config = SettingsConfigDict(
        env_prefix="MODERATION_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=True,
        description="Enable copyright scanning on upload",
    )
    service_url: str = Field(
        default="https://plyr-moderation.fly.dev",
        description="URL of the moderation service",
    )
    auth_token: str = Field(
        default="",
        description="Auth token for moderation service (X-Moderation-Key header)",
    )
    timeout_seconds: int = Field(
        default=300,
        description="Timeout for moderation service requests",
    )
    labeler_url: str = Field(
        default="https://moderation.plyr.fm",
        description="URL of the ATProto labeler service for emitting labels",
    )
    label_cache_prefix: str = Field(
        default="plyr:copyright-label:",
        description="Redis key prefix for caching copyright label status",
    )
    label_cache_ttl_seconds: int = Field(
        default=300,
        description="TTL in seconds for cached copyright label status (default 5 min)",
    )
    image_moderation_enabled: bool = Field(
        default=True,
        description="Enable image moderation via Claude vision on upload",
    )


class TranscoderSettings(AppSettingsSection):
    """Transcoder service configuration for lossless audio conversion.

    The transcoder is a standalone Rust service that converts non-web-playable
    formats (AIFF, FLAC) to MP3 for browser playback while preserving originals.
    """

    model_config = SettingsConfigDict(
        env_prefix="TRANSCODER_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=True,
        description="Enable transcoding for lossless uploads. When False, lossless formats are rejected.",
    )
    service_url: AnyHttpUrl = Field(
        default=AnyHttpUrl("https://plyr-transcoder.fly.dev"),
        description="URL of the transcoder service",
    )
    auth_token: str = Field(
        default="",
        description="Auth token for transcoder service (X-Transcoder-Key header)",
    )
    timeout_seconds: int = Field(
        default=600,
        description="Timeout for transcoder requests (10 min default for large files)",
    )
    target_format: str = Field(
        default="mp3",
        description="Target format for transcoded files",
    )


class ModalSettings(AppSettingsSection):
    """Modal compute platform settings for CLAP embedding service."""

    model_config = SettingsConfigDict(
        env_prefix="MODAL_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=False,
        description="Enable Modal CLAP embedding service",
    )
    embed_audio_url: AnyHttpUrl | None = Field(
        default=None,
        description="Modal web endpoint URL for audio embedding",
    )
    embed_text_url: AnyHttpUrl | None = Field(
        default=None,
        description="Modal web endpoint URL for text embedding",
    )
    timeout_seconds: int = Field(
        default=120,
        description="Timeout for Modal requests (includes cold start)",
    )


class ReplicateSettings(AppSettingsSection):
    """Replicate ML platform settings for effnet-discogs genre classification."""

    model_config = SettingsConfigDict(
        env_prefix="REPLICATE_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=False,
        description="Enable Replicate genre classification",
    )
    api_token: SecretStr = Field(
        default=SecretStr(""),
        description="Replicate API token (REPLICATE_API_TOKEN)",
    )
    top_n: int = Field(
        default=10,
        description="Number of top genre predictions to keep",
    )
    timeout_seconds: int = Field(
        default=120,
        description="Timeout for Replicate API requests",
    )


class TurbopufferSettings(AppSettingsSection):
    """Turbopuffer vector database settings for vibe search."""

    model_config = SettingsConfigDict(
        env_prefix="TURBOPUFFER_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=False,
        description="Enable turbopuffer vector search",
    )
    api_key: SecretStr = Field(
        default=SecretStr(""),
        description="Turbopuffer API key",
    )
    region: str = Field(
        default="api",
        description="Turbopuffer region",
    )
    namespace: str = Field(
        default="plyr-tracks",
        description="Turbopuffer namespace for track embeddings",
    )


class DocketSettings(AppSettingsSection):
    """Background task queue configuration using pydocket.

    By default uses in-memory mode (no Redis required). Set DOCKET_URL to a Redis
    URL for durable task execution that survives server restarts.
    """

    model_config = SettingsConfigDict(
        env_prefix="DOCKET_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    name: str = Field(
        default="plyr",
        description="Name of the docket instance (shared across workers)",
    )
    url: str = Field(
        default="",
        validation_alias="DOCKET_URL",
        description="Redis URL for docket (required in production). Empty disables docket.",
    )
    enabled: bool = Field(
        default=False,
        description="Enable docket background tasks. Auto-enabled when url is set.",
    )
    worker_concurrency: int = Field(
        default=10,
        description="Number of concurrent tasks per worker",
    )
    check_interval_seconds: float = Field(
        default=5.0,
        description="How often to check for new tasks (seconds). Default 5s reduces Redis costs vs docket's 250ms default.",
    )
    scheduling_resolution_seconds: float = Field(
        default=5.0,
        description="How often to run the scheduler loop (seconds). Default 5s reduces Redis costs vs docket's 250ms default.",
    )
    schedule_automatic_tasks: bool = Field(
        default=True,
        description="Schedule automatic perpetual tasks at worker startup. Disable in tests to avoid event loop issues.",
    )


class RateLimitSettings(AppSettingsSection):
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
        default="20/minute",
        description="Rate limit for file uploads",
    )


class AuthSettings(AppSettingsSection):
    """Authentication configuration."""

    model_config = SettingsConfigDict(
        env_prefix="AUTH_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    developer_token_default_days: int = Field(
        default=90,
        description="Default expiration in days for developer tokens (capped by refresh lifetime)",
    )
    developer_token_max_days: int = Field(
        default=365,
        description="Maximum allowed expiration in days for developer tokens",
    )


class AccountCreationSettings(AppSettingsSection):
    """Account creation configuration for PDS-based signup."""

    model_config = SettingsConfigDict(
        env_prefix="ACCOUNT_CREATION_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    enabled: bool = Field(
        default=True,
        description="Whether to allow new account creation via PDS selection",
    )
    recommended_pds: list[dict[str, str | bool | None]] = Field(
        default=[
            {
                "name": "selfhosted.social",
                "url": "https://selfhosted.social",
                "description": "free, community-run PDS",
                "info_url": "https://selfhosted.social/info",
            },
        ],
        description="List of recommended PDS options for account creation",
    )


class Settings(AppSettingsSection):
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
    legal: LegalSettings = Field(
        default_factory=LegalSettings,
        description="Legal and contact settings",
    )
    rate_limit: RateLimitSettings = Field(
        default_factory=RateLimitSettings,
        description="Rate limiting settings",
    )
    auth: AuthSettings = Field(
        default_factory=AuthSettings,
        description="Authentication settings",
    )
    account_creation: AccountCreationSettings = Field(
        default_factory=AccountCreationSettings,
        description="Account creation settings for PDS-based signup",
    )
    notify: NotificationSettings = Field(
        default_factory=NotificationSettings,
        description="Notification settings",
    )
    moderation: ModerationSettings = Field(
        default_factory=ModerationSettings,
        description="Moderation service settings",
    )
    transcoder: TranscoderSettings = Field(
        default_factory=TranscoderSettings,
        description="Transcoder service settings for lossless audio conversion",
    )
    teal: TealSettings = Field(
        default_factory=TealSettings,
        description="teal.fm scrobbling integration settings",
    )
    bufo: BufoSettings = Field(
        default_factory=BufoSettings,
        description="bufo easter egg settings",
    )
    docket: DocketSettings = Field(
        default_factory=DocketSettings,
        description="Background task queue settings",
    )
    modal: ModalSettings = Field(
        default_factory=ModalSettings,
        description="Modal CLAP embedding service settings",
    )
    turbopuffer: TurbopufferSettings = Field(
        default_factory=TurbopufferSettings,
        description="Turbopuffer vector search settings",
    )
    replicate: ReplicateSettings = Field(
        default_factory=ReplicateSettings,
        description="Replicate genre classification settings",
    )


settings = Settings()

"""relay configuration using pydantic-settings."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """relay application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # app settings
    app_name: str = "relay"
    debug: bool = False
    port: int = Field(default=8001, description="Server port")

    # database
    database_url: str = Field(
        default="postgresql+asyncpg://localhost/relay",
        description="PostgreSQL connection string",
    )

    # redis
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection string",
    )

    # storage
    storage_backend: str = Field(default="filesystem", description="Storage backend (filesystem or r2)")

    # cloudflare r2
    aws_access_key_id: str = Field(default="", description="AWS access key ID")
    aws_secret_access_key: str = Field(default="", description="AWS secret access key")
    r2_bucket: str = Field(default="", description="R2 bucket name")
    r2_endpoint_url: str = Field(default="", description="R2 endpoint URL")
    r2_public_bucket_url: str = Field(default="", description="R2 public bucket URL")

    # frontend
    frontend_url: str = Field(
        default="http://localhost:5173",
        description="Frontend URL for redirects",
    )
    cors_origins: list[str] = Field(
        default=["http://localhost:5173", "https://relay-4i6.pages.dev"],
        description="CORS allowed origins",
    )

    # atproto
    atproto_pds_url: str = Field(
        default="https://bsky.social",
        description="ATProto PDS URL",
    )
    atproto_client_id: str = Field(default="", description="OAuth client ID")
    atproto_client_secret: str = Field(default="", description="OAuth client secret")
    atproto_redirect_uri: str = Field(
        default="http://localhost:8000/auth/callback",
        description="OAuth redirect URI",
    )


settings = Settings()

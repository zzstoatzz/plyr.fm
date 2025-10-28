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

    # cloudflare r2
    r2_account_id: str = Field(default="", description="Cloudflare R2 account ID")
    r2_access_key_id: str = Field(default="", description="R2 access key ID")
    r2_secret_access_key: str = Field(default="", description="R2 secret access key")
    r2_bucket_name: str = Field(default="relay-audio", description="R2 bucket name")
    r2_endpoint_url: str = Field(
        default="",
        description="R2 endpoint URL (computed from account_id if not provided)",
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

    @property
    def r2_endpoint(self) -> str:
        """get r2 endpoint url."""
        if self.r2_endpoint_url:
            return self.r2_endpoint_url
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"


settings = Settings()

"""OAuth state model for storing temporary OAuth flow state."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from relay.models.database import Base


class OAuthStateModel(Base):
    """OAuth state for CSRF protection during authorization flow.

    Stores temporary state during OAuth flow (10 minute TTL).
    """

    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    pkce_verifier: Mapped[str] = mapped_column(String, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    authserver_iss: Mapped[str] = mapped_column(String, nullable=False)
    dpop_private_key_pem: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # serialized private key
    dpop_authserver_nonce: Mapped[str] = mapped_column(String, nullable=False)

    # optional fields populated during authorization
    did: Mapped[str | None] = mapped_column(String, nullable=True)
    handle: Mapped[str | None] = mapped_column(String, nullable=True)
    pds_url: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,  # for cleanup queries
    )

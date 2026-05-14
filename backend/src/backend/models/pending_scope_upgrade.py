"""pending scope upgrade model for OAuth flow metadata."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class PendingScopeUpgrade(Base):
    """temporary record linking OAuth state to scope upgrade metadata.

    when a user initiates an OAuth flow to upgrade their session scopes
    (e.g., enabling teal.fm scrobbling), we store the existing session ID
    here so the callback knows to replace it with the new session.

    records expire after 10 minutes (matching OAuth state TTL).
    """

    __tablename__ = "pending_scope_upgrades"

    state: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    did: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    # the session being upgraded - will be deleted after successful upgrade
    old_session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # the additional scopes being requested
    requested_scopes: Mapped[str] = mapped_column(String(512), nullable=False)
    # paradigm-specific payload carried through the OAuth round-trip — the
    # callback uses this to finish setting up the feature once the new session
    # has the right scopes (e.g., writing a publishingOwner record on PDS).
    paradigm_data: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True, default=None
    )
    # frontend path the callback should redirect to (e.g., "/portal"). null
    # falls back to /settings, which is where teal upgrades land.
    redirect_to: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,  # for cleanup queries
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC) + timedelta(minutes=10),
        nullable=False,
    )

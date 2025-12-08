"""pending scope upgrade model for OAuth flow metadata."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, String
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

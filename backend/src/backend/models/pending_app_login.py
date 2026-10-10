"""pending app login model for native app OAuth flow metadata."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class PendingAppLogin(Base):
    """temporary record marking an OAuth state as a native app sign-in.

    the app sends a PKCE challenge when it starts the flow. the callback finds
    it here by OAuth state, binds the one-time exchange code to it, and sends
    the browser back to the app instead of the web frontend.

    records expire after 10 minutes (matching OAuth state TTL).
    """

    __tablename__ = "pending_app_logins"

    state: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    code_challenge: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC) + timedelta(minutes=10),
        nullable=False,
    )

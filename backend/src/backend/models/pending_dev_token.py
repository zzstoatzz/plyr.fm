"""pending developer token model for OAuth flow metadata."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class PendingDevToken(Base):
    """temporary record linking OAuth state to dev token creation metadata.

    when a user initiates the OAuth flow for creating a developer token,
    we store the token name and expiration here, keyed by the OAuth state.
    the callback checks this table to know if the flow is for a dev token.

    records expire after 10 minutes (matching OAuth state TTL).
    """

    __tablename__ = "pending_dev_tokens"

    state: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    did: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    token_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expires_in_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
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

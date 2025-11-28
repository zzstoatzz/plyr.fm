"""exchange token model for secure OAuth callback flow."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class ExchangeToken(Base):
    """temporary one-time use token for exchanging OAuth callback for session.

    prevents exposing session_id in URL by using short-lived exchange tokens instead.
    tokens expire after 60 seconds and can only be used once.
    """

    __tablename__ = "exchange_tokens"

    token: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC) + timedelta(seconds=60),
        nullable=False,
    )
    used: Mapped[bool] = mapped_column(default=False, nullable=False)
    # dev token exchanges should not set browser cookies
    is_dev_token: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

"""session model for storing user sessions."""

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class UserSession(Base):
    """user session model."""

    __tablename__ = "user_sessions"

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    did: Mapped[str] = mapped_column(String, nullable=False, index=True)
    handle: Mapped[str] = mapped_column(String, nullable=False)
    oauth_session_data: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # JSON stored as text
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # developer token fields
    is_developer_token: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    token_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # multi-account session group fields
    group_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="true"
    )
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

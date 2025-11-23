"""session model for storing user sessions."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
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

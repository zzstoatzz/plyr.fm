"""user preferences model for storing per-user settings."""

from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from relay.models.database import Base


class UserPreferences(Base):
    """user preferences linked to ATProto identity."""

    __tablename__ = "user_preferences"

    # ATProto identity (foreign key to artists.did)
    did: Mapped[str] = mapped_column(String, primary_key=True)

    # ui preferences
    accent_color: Mapped[str] = mapped_column(String, nullable=False, default="#6a9fff")

    # metadata
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

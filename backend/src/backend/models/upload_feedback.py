"""Private messages about temporary upload pauses."""

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class UploadFeedback(Base):
    __tablename__ = "upload_feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    did: Mapped[str] = mapped_column(String, nullable=False)
    handle: Mapped[str | None] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

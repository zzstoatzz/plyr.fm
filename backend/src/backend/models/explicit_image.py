"""explicit image tracking for content moderation."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class ExplicitImage(Base):
    """tracks images flagged as explicit.

    images can be identified by:
    - image_id: R2 storage ID (for track/album artwork)
    - url: full URL (for external images like avatars)

    at least one must be set. if both match, the image is explicit.
    """

    __tablename__ = "explicit_images"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # one or both of these identify the image
    image_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)

    # metadata
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    flagged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    flagged_by: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # admin who flagged it

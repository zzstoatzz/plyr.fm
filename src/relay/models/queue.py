"""queue state model."""

from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from relay.models.database import Base


class QueueState(Base):
    """queue state model with revision tracking for optimistic concurrency control."""

    __tablename__ = "queue_state"

    did: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    state: Mapped[dict] = mapped_column(JSON, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
        index=True,
    )

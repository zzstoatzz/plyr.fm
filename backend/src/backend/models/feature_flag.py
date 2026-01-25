"""feature flag model for per-user feature toggles."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class FeatureFlag(Base):
    """per-user feature flag.

    stores which features are enabled for specific users.
    flags are enabled by admins and checked in backend code.
    """

    __tablename__ = "feature_flags"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_did: Mapped[str] = mapped_column(
        String,
        ForeignKey("artists.did", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    flag: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (UniqueConstraint("user_did", "flag", name="uq_user_flag"),)

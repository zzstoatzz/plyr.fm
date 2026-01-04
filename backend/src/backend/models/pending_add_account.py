"""pending add account model for multi-account OAuth flow metadata."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class PendingAddAccount(Base):
    """temporary record linking OAuth state to add-account metadata.

    when a user initiates OAuth to add another account to their session group,
    we store the group_id here, keyed by the OAuth state.
    the callback checks this table to link the new session to the existing group.

    records expire after 10 minutes (matching OAuth state TTL).
    """

    __tablename__ = "pending_add_accounts"

    state: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    group_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
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

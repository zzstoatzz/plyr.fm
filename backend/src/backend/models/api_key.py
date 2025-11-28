"""API key model for developer access."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base


class KeyType(StrEnum):
    SECRET = "secret"
    PUBLISHABLE = "publishable"


class KeyEnvironment(StrEnum):
    LIVE = "live"
    TEST = "test"


class APIKey(Base):
    """API key for developer access."""

    __tablename__ = "api_keys"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )

    # ownership
    owner_did: Mapped[str] = mapped_column(
        String,
        ForeignKey("artists.did", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # key identification
    key_prefix: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    # metadata
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_type: Mapped[str] = mapped_column(String(12), nullable=False, default="secret")
    environment: Mapped[str] = mapped_column(String(12), nullable=False, default="live")

    # access control (future)
    scopes: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    # lifecycle
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # audit
    created_from_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    last_used_from_ip: Mapped[str | None] = mapped_column(INET, nullable=True)

    # relationships
    owner = relationship("Artist", back_populates="api_keys")

    __table_args__ = (
        Index(
            "idx_api_keys_active",
            "owner_did",
            postgresql_where="revoked_at IS NULL",
        ),
    )

    @property
    def is_active(self) -> bool:
        """Check if key is active (not revoked or expired)."""
        if self.revoked_at is not None:
            return False
        return not (self.expires_at is not None and self.expires_at < datetime.now(UTC))

    @property
    def display_prefix(self) -> str:
        """Return key prefix for display (e.g., plyr_sk_live_abc1...)."""
        return f"{self.key_prefix}..."

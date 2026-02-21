"""jam models for shared listening rooms."""

from datetime import UTC, datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class Jam(Base):
    """shared listening room."""

    __tablename__ = "jams"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    host_did: Mapped[str] = mapped_column(
        String, ForeignKey("artists.did"), nullable=False
    )
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[dict] = mapped_column(JSON, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_jams_code", "code", unique=True),
        Index("ix_jams_host_did", "host_did"),
        Index(
            "ix_jams_is_active",
            "is_active",
            postgresql_where=(is_active.is_(True)),
        ),
    )


class JamParticipant(Base):
    """participant in a shared listening room."""

    __tablename__ = "jam_participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jam_id: Mapped[str] = mapped_column(
        String, ForeignKey("jams.id", ondelete="CASCADE"), nullable=False
    )
    did: Mapped[str] = mapped_column(String, ForeignKey("artists.did"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    left_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_jam_participants_jam_id", "jam_id"),
        Index(
            "ix_jam_participants_did_active",
            "did",
            postgresql_where=(left_at.is_(None)),
        ),
    )

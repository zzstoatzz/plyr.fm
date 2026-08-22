"""plyr.fm's mirror of an artist's private-media member list."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class PrivateMediaMember(Base):
    """one DID an artist lets hear their private tracks.

    the source of truth is the ``simplespace`` member list on the artist's PDS,
    consulted at credential-mint time; this row exists so listings and
    visibility checks can answer in SQL. it is written through on every
    add/remove plyr.fm performs and reconciled from ``listMembers``.
    """

    __tablename__ = "private_media_members"

    artist_did: Mapped[str] = mapped_column(String, primary_key=True)
    member_did: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (Index("ix_private_media_members_member_did", "member_did"),)

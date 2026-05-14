"""user-selected copyright paradigm config.

records which (if any) copyright paradigm a user has opted into and the AT-URI
of their paradigm-specific actor record on their PDS (e.g., a publishingOwner
record under ch.indiemusi.alpha for the indiemusi paradigm).

a user has at most one row here. swapping paradigms means updating in place.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base


class UserCopyrightConfig(Base):
    __tablename__ = "user_copyright_configs"

    user_did: Mapped[str] = mapped_column(String(256), primary_key=True)
    # stable paradigm id (e.g., "indiemusi-alpha"); matches settings.indiemusi.paradigm_id
    paradigm: Mapped[str] = mapped_column(String(64), nullable=False)
    # AT-URI of the user's primary paradigm actor record (publishingOwner for indiemusi).
    # null while setup is incomplete — user picked a paradigm but hasn't written the record yet.
    config_uri: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # paradigm-specific defaults used to prefill upload/edit forms without re-reading
    # the actor record from PDS on every render. for indiemusi this is the
    # publishingOwner field set (ipi, firstName/lastName/companyName, collectingSociety).
    # the canonical copy lives on the user's PDS; this is a cache.
    paradigm_data: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True, default=None
    )
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

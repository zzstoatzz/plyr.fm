"""user-selected copyright paradigm config.

one row per user (PK on user_did). stores the paradigm choice, the AT-URI of
the paradigm-specific actor record on the user's PDS, and a JSONB cache of the
record's field values for upload-form prefill.
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
    # paradigm-specific field cache for upload-form prefill (e.g., publishingOwner
    # fields for indiemusi). canonical copy lives on the PDS at config_uri.
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

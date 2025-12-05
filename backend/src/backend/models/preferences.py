"""user preferences model for storing per-user settings."""

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.database import Base
from backend.utilities.tags import DEFAULT_HIDDEN_TAGS


class UserPreferences(Base):
    """user preferences linked to ATProto identity."""

    __tablename__ = "user_preferences"

    # ATProto identity (foreign key to artists.did)
    did: Mapped[str] = mapped_column(String, primary_key=True)

    # ui preferences
    accent_color: Mapped[str] = mapped_column(String, nullable=False, default="#6a9fff")
    auto_advance: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    # artist preferences
    allow_comments: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # tag filtering preferences
    # stores a list of tag names that should be hidden from track listings
    # defaults to ["ai"] to hide AI-generated content by default
    hidden_tags: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: list(DEFAULT_HIDDEN_TAGS),
        server_default=text("'[\"ai\"]'::jsonb"),
    )

    # teal.fm scrobbling integration
    # when enabled, plays are written to user's PDS as fm.teal.alpha.feed.play records
    # requires re-login to grant teal scopes after enabling
    enable_teal_scrobbling: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # content preferences
    # when enabled, explicit artwork is shown unblurred
    show_explicit_artwork: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # metadata
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

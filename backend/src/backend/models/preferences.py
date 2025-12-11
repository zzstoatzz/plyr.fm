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
    # when enabled, sensitive artwork is shown unblurred
    show_sensitive_artwork: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # profile preferences
    # when enabled, liked tracks are displayed on the user's artist page
    show_liked_on_profile: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # ATProto liked list record (fm.plyr.list with listType="liked")
    liked_list_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    liked_list_cid: Mapped[str | None] = mapped_column(String, nullable=True)

    # artist support link (Ko-fi, Patreon, etc.)
    support_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # extensible UI settings (colors, background image, glass effects, etc.)
    # schema-less to avoid migrations for new UI preferences
    ui_settings: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    # terms of service acceptance
    # null means terms not yet accepted, timestamp means when they were accepted
    terms_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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

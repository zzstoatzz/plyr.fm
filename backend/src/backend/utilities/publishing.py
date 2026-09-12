"""Publishing choices, independent of storage and rights metadata."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

ListeningPolicy = Literal["public", "signed_in", "supporters", "owner", "space"]
DownloadPolicy = Literal["open", "ask", "supporters", "off"]
PublicationVisibility = Literal["public", "unlisted", "private"]
PolicyOrigin = Literal["portal", "album", "track"]


class PublishingPolicy(BaseModel):
    """A complete policy snapshot for a work or publishing template."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    listening: ListeningPolicy = "public"
    downloads: DownloadPolicy = "open"
    visibility: PublicationVisibility = "public"

    @model_validator(mode="after")
    def validate_private_audience(self) -> "PublishingPolicy":
        if self.visibility == "private" and self.listening == "public":
            raise ValueError("private works need a restricted audience")
        return self

    @property
    def requires_protected_audio(self) -> bool:
        return (
            self.listening != "public"
            or self.downloads in ("supporters", "off")
            or self.visibility == "private"
        )


class PublishingDefaults(BaseModel):
    """Settings applied to new works, never read as live catalog permissions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    access: PublishingPolicy = PublishingPolicy()
    attach_rights: bool = False


class ResolvedPublishing(BaseModel):
    """The settings and source to persist when publishing."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    settings: PublishingDefaults
    origin: PolicyOrigin


def resolve_publishing(
    *,
    portal: PublishingDefaults,
    album: PublishingDefaults | None = None,
    track: PublishingDefaults | None = None,
) -> ResolvedPublishing:
    """Resolve complete overrides once; callers persist the resulting snapshot."""
    if track is not None:
        return ResolvedPublishing(settings=track, origin="track")
    if album is not None:
        return ResolvedPublishing(settings=album, origin="album")
    return ResolvedPublishing(settings=portal, origin="portal")

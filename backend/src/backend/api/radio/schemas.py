"""Public radio response shapes.

The RadioTrack / RadioStateResponse shapes are the existing public API contract
(consumed by external clients and games) and must stay stable. Station summaries
are additive.
"""

from pydantic import BaseModel


class RadioTrack(BaseModel):
    """Small public track shape for radio clients."""

    id: int
    title: str
    artist: str
    artist_handle: str
    artist_did: str
    stream_url: str
    file_type: str
    duration: int
    artwork_url: str | None
    thumbnail_url: str | None
    atproto_record_uri: str | None
    atproto_record_cid: str | None
    created_at: str
    tags: list[str]
    like_count: int
    play_count: int
    liked: bool = False  # whether the requesting (authenticated) user liked it


class RadioStateResponse(BaseModel):
    """Live radio state response (one station's deterministic loop)."""

    station: str
    station_slug: str
    generated_at: str
    loop_duration_seconds: int
    current_index: int | None
    current_started_at: str | None
    current_ends_at: str | None
    progress_seconds: int
    current: RadioTrack | None
    up_next: list[RadioTrack]
    rotation: list[RadioTrack]


class StationSummary(BaseModel):
    """One tunable station in the lineup."""

    slug: str
    name: str
    description: str
    is_default: bool


class StationsResponse(BaseModel):
    """The current station lineup for the flip UI."""

    default_slug: str
    stations: list[StationSummary]

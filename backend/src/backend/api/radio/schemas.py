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


class LiveBroadcastInfo(BaseModel):
    """A broadcast preempting this station's rotation right now.

    Additive and optional. A client that does not know about it plays the
    rotation as before — on a station with a live source that means the
    archived recordings, which is a coherent fallback rather than a broken one.
    """

    stream_url: str
    kind: str  # "hls"
    started_at: str | None = None


class RadioStateResponse(BaseModel):
    """Live radio state response (one station's deterministic loop).

    ``live`` preempts: while it is set, the station is airing that broadcast
    and the rotation fields describe what resumes when it ends.
    """

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
    live: LiveBroadcastInfo | None = None


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
